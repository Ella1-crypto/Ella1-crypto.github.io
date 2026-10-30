"""pick.haru 쇼핑 글 예약 목록(_automation/pickharu-queue.json)에서 시각이 된 글을 올리고, 링크는 첫 댓글로 단다.

GitHub Actions(.github/workflows/threads-pickharu.yml)가 실행한다. 표준 라이브러리만 쓴다.
- 큐 파일이 push되면 바로 실행되어(--wait) 예약 시각마다 기다렸다 올린다. 한 실행이 최대 MAX_SESSION 동안 여러 글을 처리한다.
- 30분마다 도는 예약 실행은 보조다(GitHub cron은 밀리거나 건너뛴다).
안전장치 (재테크 자동 게시와 같은 방식 + 쇼핑 글 규칙):
- 올리기 전에 '올리는 중'으로 커밋·푸시. 푸시가 안 되면 올리지 않는다(중복 게시 방지).
- 토큰 계정이 pick.haru__1이 아니면 올리지 않는다.
- 쇼핑 글은 쿠팡(기본), 카카오 선물하기(kind "카카오"), 네이버 브랜드 커넥트(kind "네이버") 세 종류. 종류마다 하루(KST) 상한, 본문 마지막 줄 광고 표시, 댓글 고지 문구·링크 형식이 따로 있다(SHOPS).
- 본문 500자, 본문 주소 금지.
- 본문은 올라갔는데 댓글만 실패하면 본문은 그대로 '올림'으로 두고 reply_error에 남긴다(본문 재게시 금지).
- 토큰은 환경변수(GitHub Secrets)로만 받고 어디에도 기록하지 않는다.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable

from jaetech_publish import (
    BASE, BLOCK_RE, CONTAINER_WAIT_SECONDS, DONE, FAILED, IN_PROGRESS, KST, READY, TEXT_LIMIT,
    Http, ThreadsError, git_commit_push, git_pull, http_json, load_queue, pick_due, save_queue,
    with_status,
)

QUEUE_PATH = Path(__file__).resolve().parent / "pickharu-queue.json"
EXPECTED_USERNAME = "pick.haru__1"
SECRET_NAME = "PICKHARU_THREADS_ACCESS_TOKEN"
DAILY_CAP = 5  # 쿠팡 글
MAX_SESSION = timedelta(minutes=320)  # push 실행 하나가 기다리며 처리하는 최대 시간(워크플로 timeout 350분보다 짧게)
DISCLOSURE = "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다."
LINK_RE = re.compile(r"https://(link\.coupang\.com|(www\.)?coupang\.com)/\S+")
ANY_URL_RE = re.compile(r"https?://\S+")
BARE_DOMAIN_RE = re.compile(r"\b[\w-]+\.(com|net|kr|ng|co|me|ly|io)/", re.IGNORECASE)  # Threads가 자동 링크로 바꾸는 주소
# 응답이 끊기거나 이상해도 기록이 남게 넓게 잡는다(http_json은 HTTP·연결 오류만 ThreadsError로 바꾼다)
PUBLISH_ERRORS = (ThreadsError, KeyError, OSError, ValueError)
# 영상은 사이트 저장소 assets/pickharu/ 아래 mp4로 두고 GitHub Pages 주소로 Threads에 넘긴다(Threads가 직접 내려받음).
SITE_ROOT = QUEUE_PATH.parent.parent
SITE_URL = "https://ella1-crypto.github.io/"
VIDEO_RE = re.compile(r"assets/pickharu/[\w.-]+\.mp4")
VIDEO_MAX_BYTES = 100 * 1024 * 1024
VIDEO_POLL_SECONDS = 15
VIDEO_POLL_TRIES = 40  # 최대 10분 처리 대기
# 사진도 같은 assets/pickharu/ 아래 두고 Pages 주소로 넘긴다. 1장은 IMAGE, 2장 이상은 CAROUSEL(Threads 한도 20장).
IMAGE_RE = re.compile(r"assets/pickharu/[\w.-]+\.(jpg|jpeg|png)")
IMAGE_MAX_BYTES = 8 * 1024 * 1024
IMAGES_MAX = 20
# GIF는 GIPHY id로 붙인다(Threads 공식 문서: gif_attachment, 글자만 있는 글에서만, 제공처는 GIPHY만).
GIF_ID_RE = re.compile(r"[A-Za-z0-9]{10,40}")
AD_TAG = "[광고] 쿠팡파트너스"  # 본문 마지막 줄 (2026-10-27 사용자 지정: 첫 줄 [광고] 대신)
GENERAL = "일반"  # 계정 신뢰용 일반 글(링크 없음). 하루 상한(광고 글)에는 세지 않는다.
COUPANG, KAKAO, NAVER = "쿠팡", "카카오", "네이버"
KAKAO_DISCLOSURE = "이 포스팅은 선물하기 큐레이터 활동의 일환으로, 주문 발생 시 일정액의 수수료를 제공 받습니다."
KAKAO_LINK_RE = re.compile(r"https://gift-link\.kakao\.com/c/[A-Za-z0-9_-]+")
NAVER_DISCLOSURE = "이 포스팅은 네이버 브랜드 커넥트 활동의 일환으로, 판매 발생 시 일정액의 수수료를 제공받습니다."
NAVER_LINK_RE = re.compile(r"https://naver\.me/[A-Za-z0-9]+")  # 브랜드 커넥트 링크는 naver.me 단축 주소(2026-10-27 사용자 예시)
# 종류별 규칙: 본문 마지막 줄 표시, 댓글 고지 문구, 댓글 링크, 하루 상한 (카카오 문구·링크 형식은 2026-10-27 사용자가 준 그대로)
SHOPS = {
    COUPANG: {"tag": AD_TAG, "disclosure": DISCLOSURE, "link": LINK_RE, "cap": DAILY_CAP},
    KAKAO: {"tag": "[광고] 카카오 선물하기", "disclosure": KAKAO_DISCLOSURE, "link": KAKAO_LINK_RE, "cap": 3},  # 2026-10-30 사용자 지정: 하루 3개까지
    NAVER: {"tag": "[광고] 네이버 브랜드 커넥트", "disclosure": NAVER_DISCLOSURE, "link": NAVER_LINK_RE, "cap": 3},  # 2026-10-30 사용자 지정: 하루 3개까지
}


def video_problem(item: dict, root: Path = SITE_ROOT) -> str:
    video = item.get("video")
    if not video:
        return ""
    if not VIDEO_RE.fullmatch(video):
        return "영상 경로는 assets/pickharu/이름.mp4 여야 함"
    path = root / video
    if not path.is_file():
        return f"영상 파일이 저장소에 없음: {video}"
    if path.stat().st_size > VIDEO_MAX_BYTES:
        return "영상이 100MB 초과"
    return ""


def images_problem(item: dict, root: Path = SITE_ROOT) -> str:
    images = item.get("images") or []
    if not images:
        return ""
    if item.get("video"):
        return "영상과 사진은 함께 올릴 수 없음"
    if not isinstance(images, list) or len(images) > IMAGES_MAX:
        return f"사진은 목록으로 최대 {IMAGES_MAX}장"
    for image in images:
        if not isinstance(image, str) or not IMAGE_RE.fullmatch(image):
            return "사진 경로는 assets/pickharu/이름.jpg(.jpeg/.png) 여야 함"
        path = root / image
        if not path.is_file():
            return f"사진 파일이 저장소에 없음: {image}"
        if path.stat().st_size > IMAGE_MAX_BYTES:
            return f"사진이 8MB 초과: {image}"
    return ""


def gif_problem(item: dict) -> str:
    gif = item.get("gif")
    if not gif:
        return ""
    if item.get("video") or item.get("images"):
        return "GIF는 영상·사진 없는 글에만 붙일 수 있음"
    if not isinstance(gif, str) or not GIF_ID_RE.fullmatch(gif):
        return "GIF는 GIPHY id(영문·숫자)여야 함"
    return ""


def media_problem(item: dict) -> str:
    return video_problem(item) or images_problem(item) or gif_problem(item)


def is_general(item: dict) -> bool:
    return item.get("kind") == GENERAL


def shop_of(item: dict) -> str:
    return item.get("kind") or COUPANG  # 종류가 없으면 쿠팡 글(기존 큐 호환)


def problem_of(item: dict) -> str:
    text, reply = item.get("text", ""), item.get("reply", "")
    if not text.strip():
        return "본문이 비어 있음"
    if len(text) > TEXT_LIMIT or len(reply) > TEXT_LIMIT:
        return "본문이나 댓글이 500자 초과"
    if BLOCK_RE.search(text) or BARE_DOMAIN_RE.search(text):
        return "본문에 주소나 미완성 표시가 있음(링크는 reply에)"
    if is_general(item):  # 링크·광고 없는 일반 글: 댓글·영상 없이 본문(+사진)만
        if reply or item.get("video"):
            return "일반 글에는 댓글·영상을 넣지 않음"
        return images_problem(item) or gif_problem(item)
    kind = shop_of(item)
    if kind not in SHOPS:
        return f"알 수 없는 글 종류: {kind}"
    rule = SHOPS[kind]
    if rule["tag"] not in text.strip().splitlines()[-1]:
        return f"본문 마지막 줄에 광고 표시({rule['tag']})가 없음"
    if rule["disclosure"] not in reply:
        return f"댓글에 {kind} 고지 문구가 없음"
    urls = ANY_URL_RE.findall(reply)
    if len(urls) != 1 or not rule["link"].fullmatch(urls[0]):
        return f"댓글에 {kind} 링크가 정확히 1개 있어야 함"
    return media_problem(item)


def posted_today(items: list[dict], now: datetime, kind: str = COUPANG) -> int:
    """오늘(KST) 올렸거나 올라갔을 수 있는 kind 글 수. 게시 실패도 실제로는 올라갔을 수 있어 센다."""
    today = now.astimezone(KST).date()
    count = 0
    for it in items:
        maybe_posted = it.get("status") == FAILED and str(it.get("note", "")).startswith("게시 실패")
        if shop_of(it) != kind or (it.get("status") not in (DONE, IN_PROGRESS) and not maybe_posted):
            continue
        stamp = it.get("published_at") or it.get("publish_at")
        if not stamp:
            continue
        try:
            at = datetime.fromisoformat(stamp)
        except ValueError:
            continue
        if (at if at.tzinfo else at.replace(tzinfo=KST)).astimezone(KST).date() == today:
            count += 1
    return count


def wait_until_ready(container: str, token: str, http: Http, sleep) -> None:
    """영상 컨테이너는 Threads가 영상을 처리할 때까지 기다려야 게시할 수 있다."""
    for _ in range(VIDEO_POLL_TRIES):
        sleep(VIDEO_POLL_SECONDS)
        state = http("GET", f"{BASE}/{container}", {"fields": "status,error_message", "access_token": token})
        if state.get("status") == "FINISHED":
            return
        if state.get("status") in ("ERROR", "EXPIRED"):
            raise ThreadsError(f"영상 처리 실패: {state.get('error_message') or state.get('status')}")
    raise ThreadsError("영상 처리가 10분 안에 끝나지 않음")


def carousel_children(images: list[str], token: str, http: Http, sleep) -> str:
    """사진마다 캐러셀 항목 컨테이너를 만들고 쉼표로 이은 id를 돌려준다."""
    children = [http("POST", f"{BASE}/me/threads", {"media_type": "IMAGE", "image_url": SITE_URL + image,
                                                     "is_carousel_item": "true", "access_token": token})["id"]
                for image in images]
    sleep(CONTAINER_WAIT_SECONDS)
    return ",".join(children)


def publish(text: str, token: str, http: Http, sleep, reply_to: str = "", video: str = "",
            images: list[str] | None = None, gif: str = "") -> str:
    params = {"media_type": "TEXT", "text": text, "access_token": token}
    if video:
        params.update(media_type="VIDEO", video_url=SITE_URL + video)
    elif images and len(images) == 1:
        params.update(media_type="IMAGE", image_url=SITE_URL + images[0])
    elif images:
        params.update(media_type="CAROUSEL", children=carousel_children(images, token, http, sleep))
    elif gif:
        params["gif_attachment"] = json.dumps({"gif_id": gif, "provider": "GIPHY"})
    if reply_to:
        params["reply_to_id"] = reply_to
    container = http("POST", f"{BASE}/me/threads", params)["id"]
    if video or images:  # 사진도 Threads가 내려받아 처리할 때까지 기다린다
        wait_until_ready(container, token, http, sleep)
    else:
        sleep(CONTAINER_WAIT_SECONDS)
    return http("POST", f"{BASE}/me/threads_publish", {"creation_id": container, "access_token": token})["id"]


def check_account(token: str, http: Http = http_json) -> str:
    me = http("GET", f"{BASE}/me", {"fields": "id,username", "access_token": token})
    if me.get("username") != EXPECTED_USERNAME:
        raise ThreadsError(f"토큰 계정이 {EXPECTED_USERNAME}이 아닙니다: {me.get('username')}")
    return me["username"]


def run_once(now: datetime, token: str, http: Http = http_json,
             commit: Callable[[str], bool] = lambda m: git_commit_push(m, QUEUE_PATH),
             sleep=time.sleep, path: Path = QUEUE_PATH) -> str:
    items = load_queue(path)
    due, items = pick_due(items, now)
    if due is None:
        save_queue(items, path)
        commit("chore: pick.haru 예약 목록 정리 (늦은 글 실패 처리)")
        return "올릴 글 없음"
    problem = problem_of(due)
    if not problem and not is_general(due):
        kind = shop_of(due)
        if posted_today(items, now, kind) >= SHOPS[kind]["cap"]:
            problem = f"오늘 {kind} 글을 이미 {SHOPS[kind]['cap']}개 올려 하루 상한 초과"
    if problem:
        save_queue(with_status(items, due["id"], status=FAILED, note=problem), path)
        commit("chore: pick.haru 예약 글 검사 실패")
        return f"올리지 않음: {problem}"
    check_account(token, http)
    save_queue(with_status(items, due["id"], status=IN_PROGRESS), path)
    if not commit(f"chore: pick.haru 글 올리는 중 ({due['id']})"):
        # 로컬 파일은 이미 '올리는 중'이라 계속 돌면 이 글이 조용히 빠진다. 멈춰서 실패가 보이게 한다.
        raise SystemExit(f"올리는 중 표시를 저장하지 못해 올리지 않음 ({due['id']}) — 큐를 확인한 뒤 다시 push")
    try:
        post_id = publish(due["text"], token, http, sleep, video=due.get("video", ""), images=due.get("images"),
                          gif=due.get("gif", ""))
    except PUBLISH_ERRORS as error:
        note = f"게시 실패: {error} — Threads에 올라갔는지 먼저 확인한 뒤 다시 예약"
        save_queue(with_status(load_queue(path), due["id"], status=FAILED, note=note), path)
        commit("chore: pick.haru 글 게시 실패 기록")
        raise SystemExit(note)
    done = {"status": DONE, "post_id": post_id, "published_at": datetime.now(KST).isoformat(timespec="minutes")}
    if not is_general(due):
        try:
            done["reply_id"] = publish(due["reply"], token, http, sleep, reply_to=post_id)
        except PUBLISH_ERRORS as error:
            done["reply_error"] = f"링크 댓글 실패: {error} — 본문은 올라감, 댓글만 직접 달기"
    save_queue(with_status(load_queue(path), due["id"], **done), path)
    commit(f"chore: pick.haru 글 게시 완료 ({due['id']})")
    return f"올림: {due['id']} → {post_id}" + (" (댓글 실패)" if "reply_error" in done else "")


def next_wait(items: list[dict], now: datetime, limit: timedelta) -> float | None:
    """가장 이른 '예약' 글까지 남은 초. 지났으면 0, 없거나 limit보다 멀면 None."""
    times = []
    for it in items:
        if it.get("status") != READY:
            continue
        try:
            at = datetime.fromisoformat(it["publish_at"])
        except (KeyError, ValueError):
            return 0
        times.append(at if at.tzinfo else at.replace(tzinfo=KST))
    if not times:
        return None
    wait = (min(times) - now).total_seconds()
    return None if wait > limit.total_seconds() else max(wait, 0.0)


def session(token: str, clock: Callable[[], datetime] = lambda: datetime.now(KST), sleep=time.sleep,
            pull: Callable[[], bool] = lambda: git_pull(QUEUE_PATH), run=None,
            path: Path = QUEUE_PATH) -> list[str]:
    """push 직후 실행: MAX_SESSION 안에 예약된 글을 시각마다 기다렸다가 하나씩 올린다."""
    run = run or (lambda now: run_once(now, token, path=path))
    # checkout은 push 시점 커밋이라, 앞 실행을 기다리는 사이 큐가 바뀌었을 수 있다. 시작할 때 최신본부터 받는다.
    if not pull():
        raise SystemExit("최신 예약 목록을 받지 못해 올리지 않음")
    end = clock() + MAX_SESSION
    results = []
    while True:
        wait = next_wait(load_queue(path), clock(), end - clock())
        if wait is None:
            return results or ["올릴 글 없음"]
        if wait > 0:
            print(f"{int(wait // 60)}분 {int(wait % 60)}초 기다린 뒤 올립니다.", flush=True)
            sleep(wait)
            # 기다리는 동안 큐가 바뀌었을 수 있다(취소·수정). 최신본을 못 받으면 올리지 않는다.
            if not pull():
                raise SystemExit("기다린 뒤 최신 예약 목록을 받지 못해 올리지 않음")
        results.append(run(clock()))
        print(results[-1], flush=True)


def refresh(token: str, repo: str, pat: str, http: Http = http_json, gh=None, encrypt=None,
            mask: Callable[[str], None] = lambda s: None) -> str:
    from refresh_token import github_call, refresh_threads_token, sealed_box_encrypt, update_secret
    new_token, expires_in = refresh_threads_token(token, http)
    mask(new_token)
    check_account(new_token, http)  # 새 토큰이 같은 계정인지 확인한 뒤에만 바꾼다
    update_secret(repo, new_token, gh or github_call(pat), encrypt or sealed_box_encrypt, name=SECRET_NAME)
    return f"pick.haru 토큰 갱신 완료 — 앞으로 {expires_in // 86400}일 유효"


def main() -> int:
    token = os.environ.get("PICKHARU_THREADS_ACCESS_TOKEN", "").strip()
    if not token:
        print("PICKHARU_THREADS_ACCESS_TOKEN Secret이 없습니다.", file=sys.stderr)
        return 1
    if "--check" in sys.argv:
        print(f"토큰 정상: {check_account(token)}")
        return 0
    if "--refresh" in sys.argv:
        pat = os.environ.get("GH_SECRETS_PAT", "").strip()
        repo = os.environ.get("GITHUB_REPOSITORY", "").strip()
        if not pat:
            print("::warning::GH_SECRETS_PAT Secret이 없어 토큰 자동 갱신을 건너뜁니다.")
            return 0
        print(refresh(token, repo, pat, mask=lambda s: print(f"::add-mask::{s}")))
        return 0
    if "--wait" in sys.argv:
        session(token)
        return 0
    print(run_once(datetime.now(KST), token))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
