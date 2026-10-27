"""pick.haru 쇼핑 글 예약 목록(_automation/pickharu-queue.json)에서 시각이 된 글을 올리고, 링크는 첫 댓글로 단다.

GitHub Actions(.github/workflows/threads-pickharu.yml)가 실행한다. 표준 라이브러리만 쓴다.
- 큐 파일이 push되면 바로 실행되어(--wait) 예약 시각마다 기다렸다 올린다. 한 실행이 최대 MAX_SESSION 동안 여러 글을 처리한다.
- 30분마다 도는 예약 실행은 보조다(GitHub cron은 밀리거나 건너뛴다).
안전장치 (재테크 자동 게시와 같은 방식 + 쇼핑 글 규칙):
- 올리기 전에 '올리는 중'으로 커밋·푸시. 푸시가 안 되면 올리지 않는다(중복 게시 방지).
- 토큰 계정이 pick.haru__1이 아니면 올리지 않는다.
- 하루(KST) 최대 DAILY_CAP개. 본문 500자, 본문 주소 금지, 본문 첫 줄 광고 표시, 댓글에 쿠팡 파트너스 고지 문구와 쿠팡 링크.
- 본문은 올라갔는데 댓글만 실패하면 본문은 그대로 '올림'으로 두고 reply_error에 남긴다(본문 재게시 금지).
- 토큰은 환경변수(GitHub Secrets)로만 받고 어디에도 기록하지 않는다.
"""
from __future__ import annotations

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
DAILY_CAP = 5
MAX_SESSION = timedelta(minutes=320)  # push 실행 하나가 기다리며 처리하는 최대 시간(워크플로 timeout 350분보다 짧게)
DISCLOSURE = "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다."
AD_MARK_RE = re.compile(r"광고|쿠팡\s?파트너스")
LINK_RE = re.compile(r"https://(link\.coupang\.com|(www\.)?coupang\.com)/\S+")
ANY_URL_RE = re.compile(r"https?://\S+")
BARE_DOMAIN_RE = re.compile(r"\b[\w-]+\.(com|net|kr|ng|co|me|ly|io)/", re.IGNORECASE)  # Threads가 자동 링크로 바꾸는 주소
# 응답이 끊기거나 이상해도 기록이 남게 넓게 잡는다(http_json은 HTTP·연결 오류만 ThreadsError로 바꾼다)
PUBLISH_ERRORS = (ThreadsError, KeyError, OSError, ValueError)


def problem_of(item: dict) -> str:
    text, reply = item.get("text", ""), item.get("reply", "")
    if not text.strip():
        return "본문이 비어 있음"
    if len(text) > TEXT_LIMIT or len(reply) > TEXT_LIMIT:
        return "본문이나 댓글이 500자 초과"
    if BLOCK_RE.search(text) or BARE_DOMAIN_RE.search(text):
        return "본문에 주소나 미완성 표시가 있음(링크는 reply에)"
    if not AD_MARK_RE.search(text.strip().splitlines()[0]):
        return "본문 첫 줄에 광고 표시(광고/쿠팡 파트너스)가 없음"
    if DISCLOSURE not in reply:
        return "댓글에 쿠팡 파트너스 고지 문구가 없음"
    urls = ANY_URL_RE.findall(reply)
    if len(urls) != 1 or not LINK_RE.fullmatch(urls[0]):
        return "댓글에 쿠팡 링크가 정확히 1개 있어야 함"
    return ""


def posted_today(items: list[dict], now: datetime) -> int:
    """오늘(KST) 올렸거나 올라갔을 수 있는 글 수. 게시 실패도 실제로는 올라갔을 수 있어 센다."""
    today = now.astimezone(KST).date()
    count = 0
    for it in items:
        maybe_posted = it.get("status") == FAILED and str(it.get("note", "")).startswith("게시 실패")
        if it.get("status") not in (DONE, IN_PROGRESS) and not maybe_posted:
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


def publish(text: str, token: str, http: Http, sleep, reply_to: str = "") -> str:
    params = {"media_type": "TEXT", "text": text, "access_token": token}
    if reply_to:
        params["reply_to_id"] = reply_to
    container = http("POST", f"{BASE}/me/threads", params)["id"]
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
    if not problem and posted_today(items, now) >= DAILY_CAP:
        problem = f"오늘 이미 {DAILY_CAP}개를 올려 하루 상한 초과"
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
        post_id = publish(due["text"], token, http, sleep)
    except PUBLISH_ERRORS as error:
        note = f"게시 실패: {error} — Threads에 올라갔는지 먼저 확인한 뒤 다시 예약"
        save_queue(with_status(load_queue(path), due["id"], status=FAILED, note=note), path)
        commit("chore: pick.haru 글 게시 실패 기록")
        raise SystemExit(note)
    done = {"status": DONE, "post_id": post_id, "published_at": datetime.now(KST).isoformat(timespec="minutes")}
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
