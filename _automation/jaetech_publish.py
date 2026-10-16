"""재테크 한 줄 예약 목록(_automation/jaetech-queue.json)에서 시각이 된 글을 Threads에 올린다.

GitHub Actions(.github/workflows/threads-jaetech.yml)가 5분마다 실행한다. 표준 라이브러리만 쓴다.
안전장치:
- 실행 한 번에 글은 최대 1개만 올린다.
- 올리기 전에 상태를 '올리는 중'으로 바꿔 커밋·푸시한다. 푸시가 안 되면 올리지 않는다(중복 게시 방지).
- 예약 시각을 LATE_LIMIT 넘게 지난 글은 올리지 않고 '실패'로 남긴다.
- 500자 초과, 본문 주소, 미완성 표시가 있으면 올리지 않는다.
- 토큰은 환경변수(GitHub Secrets)로만 받고 어디에도 기록하지 않는다.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

KST = timezone(timedelta(hours=9))
BASE = "https://graph.threads.net/v1.0"
QUEUE_PATH = Path(__file__).resolve().parent / "jaetech-queue.json"
LATE_LIMIT = timedelta(hours=4)  # GitHub 예약 실행은 몇 시간씩 밀릴 수 있다(2026-10-16 실측 약 3시간)
TEXT_LIMIT = 500
EXPECTED_USERNAME = "heeya.dailyfit"
PUBLISH_RETRY_WAIT_SECONDS = 15
CONTAINER_WAIT_SECONDS = 3
BLOCK_RE = re.compile(r"https?://|www\.|example\.com|\[확인 필요\]|\[\s*_{2,}", re.IGNORECASE)

READY, IN_PROGRESS, DONE, FAILED = "예약", "올리는 중", "올림", "실패"

Http = Callable[[str, str, dict], dict]


class ThreadsError(RuntimeError):
    pass


def http_json(method: str, url: str, params: dict) -> dict:
    """Threads API 호출. 오류 메시지에 토큰이 섞이지 않게 API의 message만 돌려준다."""
    data = urllib.parse.urlencode(params).encode()
    if method == "GET":
        req = urllib.request.Request(f"{url}?{data.decode()}", method="GET")
    else:
        req = urllib.request.Request(url, data=data, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read().decode()).get("error", {})
        except Exception:
            body = {}
        hint = " (토큰 만료 — 새 토큰을 Secrets에 넣어 주세요)" if body.get("code") == 190 else ""
        raise ThreadsError(f"HTTP {error.code}: {body.get('message', '응답 오류')}{hint}") from None
    except urllib.error.URLError as error:
        raise ThreadsError(f"연결 실패: {error.reason}") from None


def publish_text(text: str, token: str, user_id: str, http: Http = http_json, sleep=time.sleep) -> str:
    container = http("POST", f"{BASE}/{user_id}/threads",
                     {"media_type": "TEXT", "text": text, "access_token": token})["id"]
    sleep(CONTAINER_WAIT_SECONDS)
    params = {"creation_id": container, "access_token": token}
    try:
        return http("POST", f"{BASE}/{user_id}/threads_publish", params)["id"]
    except ThreadsError:
        # 같은 컨테이너로 한 번만 다시 시도한다. 게시가 실패한 컨테이너라 중복 게시는 생기지 않는다.
        sleep(PUBLISH_RETRY_WAIT_SECONDS)
        return http("POST", f"{BASE}/{user_id}/threads_publish", params)["id"]


def check_token(token: str, http: Http = http_json) -> str:
    me = http("GET", f"{BASE}/me", {"fields": "id,username", "access_token": token})
    if me.get("username") != EXPECTED_USERNAME:
        raise ThreadsError(f"토큰 계정이 {EXPECTED_USERNAME}이 아닙니다: {me.get('username')}")
    return me["username"]


def load_queue(path: Path = QUEUE_PATH) -> list[dict]:
    items = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(items, list):
        raise ValueError("예약 목록 형식이 잘못됐습니다(목록이 아님)")
    return items


def save_queue(items: list[dict], path: Path = QUEUE_PATH) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    tmp.replace(path)


def with_status(items: list[dict], item_id: str, **changes) -> list[dict]:
    return [{**it, **changes} if it.get("id") == item_id else it for it in items]


def problem_of(item: dict) -> str:
    text = item.get("text", "")
    if not text.strip():
        return "본문이 비어 있음"
    if len(text) > TEXT_LIMIT:
        return f"{len(text)}자 (500자 초과)"
    if BLOCK_RE.search(text):
        return "본문에 주소나 미완성 표시가 있음"
    return ""


def pick_due(items: list[dict], now: datetime) -> tuple[dict | None, list[dict]]:
    """올릴 글 하나와, 늦어서 '실패'로 바꾼 뒤의 목록을 돌려준다."""
    due = None
    updated = items
    for item in sorted(items, key=lambda it: it.get("publish_at", "")):
        if item.get("status") != READY:
            continue
        try:
            at = datetime.fromisoformat(item["publish_at"])
        except (KeyError, ValueError):
            updated = with_status(updated, item["id"], status=FAILED, note="예약 시각을 읽을 수 없음")
            continue
        if at.tzinfo is None:
            at = at.replace(tzinfo=KST)
        if at > now:
            continue
        if now - at > LATE_LIMIT:
            updated = with_status(updated, item["id"], status=FAILED, note="예약 시각보다 4시간 넘게 늦어 올리지 않음")
            continue
        if due is None:
            due = item
    return due, updated


def git_commit_push(message: str, path: Path = QUEUE_PATH) -> bool:
    root = path.parent.parent
    run = lambda *args: subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)
    run("add", "--", str(path))
    if run("diff", "--cached", "--quiet").returncode == 0:
        return True
    if run("commit", "-m", message).returncode != 0:
        return False
    if run("push").returncode == 0:
        return True
    # 다른 커밋이 먼저 들어온 경우 한 번만 맞춰서 다시 민다.
    return run("pull", "--rebase").returncode == 0 and run("push").returncode == 0


def run_once(now: datetime, token: str, user_id: str, http: Http = http_json,
             commit: Callable[[str], bool] = git_commit_push, sleep=time.sleep,
             path: Path = QUEUE_PATH) -> str:
    items = load_queue(path)
    due, items = pick_due(items, now)
    if due is None:
        save_queue(items, path)
        commit("chore: 재테크 예약 목록 정리 (늦은 글 실패 처리)")
        return "올릴 글 없음"
    problem = problem_of(due)
    if problem:
        save_queue(with_status(items, due["id"], status=FAILED, note=problem), path)
        commit("chore: 재테크 예약 글 검사 실패")
        return f"올리지 않음: {problem}"
    save_queue(with_status(items, due["id"], status=IN_PROGRESS), path)
    if not commit(f"chore: 재테크 글 올리는 중 ({due['id']})"):
        return "올리는 중 표시를 저장하지 못해 올리지 않음"
    try:
        post_id = publish_text(due["text"], token, user_id, http, sleep)
    except (ThreadsError, KeyError) as error:
        note = f"게시 실패: {error} — Threads에 올라갔는지 먼저 확인한 뒤 다시 예약"
        save_queue(with_status(load_queue(path), due["id"], status=FAILED, note=note), path)
        commit("chore: 재테크 글 게시 실패 기록")
        raise SystemExit(note)
    published = datetime.now(KST).isoformat(timespec="minutes")
    save_queue(with_status(load_queue(path), due["id"], status=DONE, post_id=post_id, published_at=published), path)
    commit(f"chore: 재테크 글 게시 완료 ({due['id']})")
    return f"올림: {due['id']} → {post_id}"


def main() -> int:
    token = os.environ.get("THREADS_ACCESS_TOKEN", "").strip()
    user_id = os.environ.get("THREADS_USER_ID", "").strip()
    if not token or not user_id:
        print("THREADS_ACCESS_TOKEN / THREADS_USER_ID Secrets가 없습니다.", file=sys.stderr)
        return 1
    if "--check" in sys.argv:
        print(f"토큰 정상: {check_token(token)}")
        return 0
    print(run_once(datetime.now(KST), token, user_id))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
