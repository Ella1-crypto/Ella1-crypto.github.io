"""pick.haru 인스타그램(@pick.haru.daily) 카드뉴스 예약 목록(_automation/pickharu-ig-queue.json)에서 시각이 된 글을 올린다.

GitHub Actions(.github/workflows/ig-pickharu.yml)가 실행한다. 표준 라이브러리만 쓴다.
스레드 자동 게시(pickharu_publish.py)와 같은 방식:
- 큐가 push되면 바로 실행되어(--wait) 예약 시각마다 기다렸다 올린다. 30분 cron은 보조.
- 올리기 전에 '올리는 중'으로 커밋·푸시. 푸시가 안 되면 올리지 않는다(중복 게시 방지).
인스타 규칙:
- 사진은 assets/pickharu/ig/<글 id>/NN.jpg (인스타 API는 JPEG만 받음), 1~10장. 2장 이상이면 캐러셀.
- 캡션 2,200자, 해시태그 30개까지. 광고 글(ad: true)은 캡션 첫 줄에 [광고].
- 게시 뒤 comment(출처 등)가 있으면 첫 댓글로 달고(블로그 주소는 넣지 않음), 스토리도 올린다(2026-10-30 사용자 지정).
  댓글·스토리가 실패해도 본 게시물은 '올림'으로 두고 comment_error·story_error에 남긴다(재게시 금지).
- 릴스(2026-10-31 사용자 지정): item.video(assets/pickharu/ig/<id>/reel.mp4)가 있으면 사진 대신 릴스로 올린다.
  기본은 릴스 탭에만(share_to_feed false — 피드 격자에 같은 글이 두 번 보이지 않게), 스토리는 안 올림, 첫 댓글은 같음.
  상한은 피드와 따로 REELS_CAP.
- 하루(KST) 상한 DAILY_CAP. 계정이 pick.haru.daily가 아니면 올리지 않는다.
- 인스타 계정 숫자 ID는 PICKHARU_IG_USER_ID(있으면) 또는 DEFAULT_IG_USER를 쓰고, 쓰기 전에 계정 이름을 확인한다.
- 토큰은 환경변수(GitHub Secrets)로만 받고 어디에도 기록하지 않는다.
"""
from __future__ import annotations

import os
import re
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Callable

from jaetech_publish import (
    DONE, FAILED, IN_PROGRESS, KST, Http, ThreadsError, git_commit_push, git_pull, http_json, load_queue,
    pick_due, save_queue, with_status,
)
from pickharu_publish import PUBLISH_ERRORS, posted_today, session

QUEUE_PATH = Path(__file__).resolve().parent / "pickharu-ig-queue.json"
SITE_ROOT = QUEUE_PATH.parent.parent
SITE_URL = "https://ella1-crypto.github.io/"
GRAPH = "https://graph.facebook.com/v21.0"
EXPECTED_USERNAME = "pick.haru.daily"
# 비즈니스 설정 Instagram 계정 화면의 게시용 ID(2026-10-30 확인, ig-check로 토큰 접근·게시 한도 확인). 공개값.
DEFAULT_IG_USER = "17841426433649539"
DAILY_CAP = 8  # 2026-10-31 사용자 지정 "한도를 늘리자": 하루 8개까지(10-30엔 5개, 처음엔 2개)
REELS_CAP = 12  # 2026-10-31 사용자: 피드+릴스 세트로 하면서 8→12(오늘 카드뉴스 7개 릴스 + 예약 피드 세트), 피드 상한과 따로 셈
KIND = "인스타"  # posted_today가 종류별로 셀 때 쓰는 값
REEL_KIND = "릴스"
IMAGE_RE = re.compile(r"assets/pickharu/ig/[\w.-]+/[\w.-]+\.jpe?g")
VIDEO_RE = re.compile(r"assets/pickharu/ig/[\w.-]+/[\w.-]+\.mp4")
IMAGE_MAX_BYTES = 8 * 1024 * 1024
VIDEO_MAX_BYTES = 100 * 1024 * 1024
IMAGES_MAX = 10
CAPTION_LIMIT = 2200
HASHTAG_LIMIT = 30
AD_TAG = "[광고]"
BLOG = "blog.naver.com/goghibli"  # 첫 댓글에 넣지 않는다(2026-10-30 밤 사용자 지정: 블로그 주소 댓글 빼기)
STATUS_POLL_SECONDS = 5
STATUS_POLL_TRIES = 36  # 최대 3분 처리 대기
VIDEO_POLL_TRIES = 120  # 영상은 최대 10분


def comment_of(item: dict) -> str:
    """첫 댓글. 2026-10-30 밤 사용자 지정: 블로그 주소 댓글은 빼고 item.comment(출처 등)만, 없으면 댓글 없음."""
    return (item.get("comment") or "").strip()


def story_problem(item: dict, root: Path) -> str:
    rel = item.get("story_image", "")
    if not IMAGE_RE.fullmatch(rel or ""):
        return f"스토리만 올리는 글엔 story_image(assets/pickharu/ig/<id>/이름.jpg)가 필요함: {rel}"
    return "" if (root / rel).is_file() else f"스토리 사진 파일이 저장소에 없음: {rel}"


def problem_of(item: dict, root: Path = SITE_ROOT) -> str:
    if item.get("story_only"):  # 스토리만 다시 올리기(2026-10-30: 찌그러진 스토리 교체)
        return story_problem(item, root)
    caption = item.get("caption", "")
    if not caption.strip():
        return "캡션이 비어 있음"
    if len(caption) > CAPTION_LIMIT:
        return f"캡션이 {CAPTION_LIMIT}자를 넘음({len(caption)}자)"
    if len(re.findall(r"#\S+", caption)) > HASHTAG_LIMIT:
        return f"해시태그가 {HASHTAG_LIMIT}개를 넘음"
    if BLOG in comment_of(item):
        return "첫 댓글에 블로그 주소가 있음 — 블로그 주소 댓글은 빼기로 함(2026-10-30)"
    if item.get("ad") and AD_TAG not in caption.strip().splitlines()[0]:
        return f"광고 글인데 캡션 첫 줄에 {AD_TAG} 표시가 없음"
    if "video" in item:
        return video_problem(item["video"], root)
    images = item.get("images") or []
    if not images:
        return "사진이 없음"
    if len(images) > IMAGES_MAX:
        return f"사진은 {IMAGES_MAX}장까지(지금 {len(images)}장)"
    # story_image: 스토리용 9:16(1080x1920) 판. 없으면 첫 장을 그대로 스토리에(2026-10-30 사용자: 사이즈가 안 맞음)
    for image in images + ([item["story_image"]] if item.get("story_image") else []):
        if not isinstance(image, str) or not IMAGE_RE.fullmatch(image):
            return f"사진 경로는 assets/pickharu/ig/<글 id>/이름.jpg 여야 함: {image}"
        path = root / image
        if not path.is_file():
            return f"사진 파일이 저장소에 없음: {image}"
        if path.stat().st_size > IMAGE_MAX_BYTES:
            return f"사진이 8MB 초과: {image}"
    return ""


def video_problem(video: str, root: Path) -> str:
    if not isinstance(video, str) or not VIDEO_RE.fullmatch(video):
        return f"릴스 영상 경로는 assets/pickharu/ig/<글 id>/이름.mp4 여야 함: {video}"
    path = root / video
    if not path.is_file():
        return f"릴스 영상 파일이 저장소에 없음: {video}"
    return f"릴스 영상이 100MB 초과: {video}" if path.stat().st_size > VIDEO_MAX_BYTES else ""


def find_ig_user(token: str, http: Http = http_json, configured: str = "") -> str:
    """올릴 인스타 계정 숫자 ID. 정해 둔 ID가 있으면 계정 이름만 확인하고, 없으면 페이지 연결 계정을 찾는다."""
    if configured:
        name = http("GET", f"{GRAPH}/{configured}", {"fields": "id,username", "access_token": token}).get("username")
        if name != EXPECTED_USERNAME:
            raise ThreadsError(f"인스타 계정이 {EXPECTED_USERNAME}이 아닙니다: {name}")
        return configured
    pages = http("GET", f"{GRAPH}/me/accounts",
                 {"fields": "instagram_business_account{id,username}", "access_token": token})
    for page in pages.get("data", []):
        account = page.get("instagram_business_account") or {}
        if account.get("username") == EXPECTED_USERNAME:
            return account["id"]
    raise ThreadsError(f"{EXPECTED_USERNAME} 계정을 찾지 못함 — 페이스북 페이지에 인스타를 연결하고 "
                       "pickharu-bot에 페이지를 할당한 뒤 토큰을 다시 만들어야 함")


def wait_until_ready(container: str, token: str, http: Http, sleep, tries: int = STATUS_POLL_TRIES) -> None:
    """인스타가 사진·영상을 내려받아 처리할 때까지 기다린다. 그 전에 게시하면 실패한다."""
    for _ in range(tries):
        state = http("GET", f"{GRAPH}/{container}", {"fields": "status_code", "access_token": token})
        if state.get("status_code") == "FINISHED":
            return
        if state.get("status_code") in ("ERROR", "EXPIRED"):
            raise ThreadsError(f"인스타 사진 처리 실패: {state.get('status_code')}")
        sleep(STATUS_POLL_SECONDS)
    raise ThreadsError(f"인스타 처리가 {tries * STATUS_POLL_SECONDS // 60}분 안에 끝나지 않음")


def publish(item: dict, ig_user: str, token: str, http: Http, sleep) -> str:
    media = f"{GRAPH}/{ig_user}/media"
    if "video" in item:
        container = http("POST", media, {"media_type": "REELS", "video_url": SITE_URL + item["video"],
                                         "caption": item["caption"],
                                         "share_to_feed": "true" if item.get("share_to_feed") else "false",
                                         "access_token": token})["id"]
        wait_until_ready(container, token, http, sleep, VIDEO_POLL_TRIES)
        return http("POST", f"{GRAPH}/{ig_user}/media_publish", {"creation_id": container, "access_token": token})["id"]
    images = item["images"]
    if len(images) == 1:
        container = http("POST", media, {"image_url": SITE_URL + images[0], "caption": item["caption"],
                                         "access_token": token})["id"]
    else:
        children = []
        for image in images:
            child = http("POST", media, {"image_url": SITE_URL + image, "is_carousel_item": "true",
                                         "access_token": token})["id"]
            wait_until_ready(child, token, http, sleep)
            children.append(child)
        container = http("POST", media, {"media_type": "CAROUSEL", "children": ",".join(children),
                                         "caption": item["caption"], "access_token": token})["id"]
    wait_until_ready(container, token, http, sleep)
    return http("POST", f"{GRAPH}/{ig_user}/media_publish", {"creation_id": container, "access_token": token})["id"]


def post_comment(media_id: str, message: str, token: str, http: Http) -> str:
    return http("POST", f"{GRAPH}/{media_id}/comments", {"message": message, "access_token": token})["id"]


def publish_story(image: str, ig_user: str, token: str, http: Http, sleep) -> str:
    """카드 첫 장을 스토리로 올린다(4:5 사진은 인스타가 9:16 화면 가운데에 놓는다)."""
    container = http("POST", f"{GRAPH}/{ig_user}/media", {"media_type": "STORIES", "image_url": SITE_URL + image,
                                                         "access_token": token})["id"]
    wait_until_ready(container, token, http, sleep)
    return http("POST", f"{GRAPH}/{ig_user}/media_publish", {"creation_id": container, "access_token": token})["id"]


def kind_of(item: dict) -> str:
    return "스토리" if item.get("story_only") else REEL_KIND if "video" in item else KIND


def image_ready(rel: str, site_root: Path = SITE_ROOT) -> bool:
    """GitHub Pages에 사진이 실제로 반영됐는지(크기까지 같은지) 본다.

    2026-10-30: push 3분 뒤 올렸다가 Pages 배포 전이라 인스타가 404를 받아 실패함
    ("Only photo or video can be accepted"). 반영 전이면 예약 상태로 두고 다음 확인 때 올린다.
    """
    request = urllib.request.Request(SITE_URL + rel, method="HEAD")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            same_size = int(response.headers.get("Content-Length", -1)) == (site_root / rel).stat().st_size
            media = "video" if rel.endswith(".mp4") else "image"
            return response.status == 200 and media in response.headers.get("Content-Type", "") and same_size
    except (OSError, ValueError):
        return False


def publish_story_only(due: dict, ig_user: str, token: str, http: Http, sleep,
                       commit: Callable[[str], bool], path: Path) -> str:
    try:
        story_id = publish_story(due["story_image"], ig_user, token, http, sleep)
    except PUBLISH_ERRORS as error:
        note = f"스토리 실패: {error} — 인스타에 올라갔는지 먼저 확인한 뒤 다시 예약"
        save_queue(with_status(load_queue(path), due["id"], status=FAILED, note=note), path)
        commit("chore: pick.haru 인스타 스토리 실패 기록")
        raise SystemExit(note)
    done = {"status": DONE, "story_id": story_id, "published_at": datetime.now(KST).isoformat(timespec="minutes")}
    save_queue(with_status(load_queue(path), due["id"], **done), path)
    commit(f"chore: pick.haru 인스타 스토리 완료 ({due['id']})")
    return f"스토리 올림: {due['id']} → {story_id}"


def run_once(now: datetime, token: str, http: Http = http_json,
             commit: Callable[[str], bool] = lambda m: git_commit_push(m, QUEUE_PATH),
             sleep=time.sleep, path: Path = QUEUE_PATH, site_root: Path = SITE_ROOT,
             configured_user: str = "", ready: Callable[[str], bool] | None = None) -> str:
    # posted_today가 인스타 게시물만 세도록(스토리만 올리는 글은 하루 상한에 안 셈)
    items = [{**it, "kind": kind_of(it)} for it in load_queue(path)]
    due, items = pick_due(items, now)
    strip = lambda its: [{k: v for k, v in it.items() if k != "kind"} for it in its]
    if due is None:
        save_queue(strip(items), path)
        commit("chore: pick.haru 인스타 예약 목록 정리 (늦은 글 실패 처리)")
        return "올릴 글 없음"
    problem = problem_of(due, site_root)
    kind = kind_of(due)
    cap = REELS_CAP if kind == REEL_KIND else DAILY_CAP
    if not problem and kind != "스토리" and posted_today(items, now, kind) >= cap:
        problem = f"오늘 인스타 {'릴스' if kind == REEL_KIND else '글'}를 이미 {cap}개 올려 하루 상한 초과"
    if problem:
        save_queue(strip(with_status(items, due["id"], status=FAILED, note=problem)), path)
        commit("chore: pick.haru 인스타 예약 글 검사 실패")
        return f"올리지 않음: {problem}"
    media = [due["video"]] if "video" in due else [] if due.get("story_only") else due["images"]
    needed = media + ([due["story_image"]] if due.get("story_image") else [])
    if ready and not all(ready(rel) for rel in needed):
        return f"사진 반영 대기: {due['id']} (GitHub Pages 배포 전 — 예약 그대로, 다음 확인 때 올림)"
    try:
        ig_user = find_ig_user(token, http, configured_user)
    except PUBLISH_ERRORS as error:
        save_queue(strip(with_status(items, due["id"], status=FAILED, note=f"계정 확인 실패: {error}")), path)
        commit("chore: pick.haru 인스타 계정 확인 실패 기록")
        raise SystemExit(f"계정 확인 실패: {error}")
    save_queue(strip(with_status(items, due["id"], status=IN_PROGRESS)), path)
    if not commit(f"chore: pick.haru 인스타 올리는 중 ({due['id']})"):
        raise SystemExit(f"올리는 중 표시를 저장하지 못해 올리지 않음 ({due['id']}) — 큐를 확인한 뒤 다시 push")
    if due.get("story_only"):
        return publish_story_only(due, ig_user, token, http, sleep, commit, path)
    try:
        post_id = publish(due, ig_user, token, http, sleep)
    except PUBLISH_ERRORS as error:
        note = f"게시 실패: {error} — 인스타에 올라갔는지 먼저 확인한 뒤 다시 예약"
        save_queue(with_status(load_queue(path), due["id"], status=FAILED, note=note), path)
        commit("chore: pick.haru 인스타 게시 실패 기록")
        raise SystemExit(note)
    done = {"status": DONE, "post_id": post_id, "published_at": datetime.now(KST).isoformat(timespec="minutes")}
    if comment_of(due):
        try:
            done["comment_id"] = post_comment(post_id, comment_of(due), token, http)
        except PUBLISH_ERRORS as error:
            done["comment_error"] = f"첫 댓글 실패: {error} — 게시물은 올라감, 댓글만 직접 달기"
    if due.get("story", "video" not in due):
        try:
            done["story_id"] = publish_story(due.get("story_image") or due["images"][0], ig_user, token, http, sleep)
        except PUBLISH_ERRORS as error:
            done["story_error"] = f"스토리 실패: {error} — 게시물은 올라감, 스토리만 직접 올리기"
    save_queue(with_status(load_queue(path), due["id"], **done), path)
    commit(f"chore: pick.haru 인스타 게시 완료 ({due['id']})")
    misses = [k for k in ("comment_error", "story_error") if k in done]
    return f"올림: {due['id']} → {post_id}" + (f" ({', '.join(misses)})" if misses else "")


def main() -> int:
    token = os.environ.get("PICKHARU_IG_ACCESS_TOKEN", "").strip()
    if not token:
        print("PICKHARU_IG_ACCESS_TOKEN Secret이 없습니다.", file=sys.stderr)
        return 1
    configured = os.environ.get("PICKHARU_IG_USER_ID", "").strip() or DEFAULT_IG_USER
    if "--check" in sys.argv:
        print(f"인스타 계정 확인: {EXPECTED_USERNAME} (ID {find_ig_user(token, configured=configured)})")
        return 0
    run = lambda now: run_once(now, token, configured_user=configured, ready=image_ready)
    if "--wait" in sys.argv:
        for line in session(token, run=run, path=QUEUE_PATH, pull=lambda: git_pull(QUEUE_PATH)):
            print(line)
        return 0
    print(run(datetime.now(KST)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
