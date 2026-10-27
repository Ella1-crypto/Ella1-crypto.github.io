"""사용자가 고른 pick.haru 초안만 예약 목록(pickharu-queue.json)에 넣고 커밋·푸시한다.

사용: python pickharu_enqueue.py <drafts/날짜.json> --ids 1,3,5 [--start 2026-10-28T17:10] [--dry-run]
- 카카오 초안 파일(drafts/kakao-날짜.json, kind "카카오")도 같은 방법. 카카오 글은 :40분에 넣어 쿠팡(:10분)과 겹치지 않게 한다.
- id는 초안 id의 끝 번호(ph-20261028-3 → 3) 또는 전체 id.
- 시각: --start부터(없으면 지금+20분 뒤 첫 :10분, 카카오는 :40분) 1시간 간격. push 실행이 기다리는 320분 안에 모두 들어가야 한다.
- 검사(pickharu_publish.problem_of)를 하나라도 통과 못 하면 아무것도 넣지 않는다.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

from jaetech_publish import KST, READY, load_queue, save_queue
from pickharu_publish import KAKAO, MAX_SESSION, QUEUE_PATH, SHOPS, problem_of, shop_of

QUEUE_FIELDS = ("id", "kind", "publish_at", "text", "reply", "keyword", "product", "video")
GAP = timedelta(hours=1)
LEAD = timedelta(minutes=20)


def first_slot(now: datetime, minute: int = 10) -> datetime:
    """지금+20분 이후 첫 :minute분."""
    at = (now + LEAD).replace(second=0, microsecond=0)
    at = at.replace(minute=minute) if at.minute <= minute else (at + timedelta(hours=1)).replace(minute=minute)
    return at


def pick(drafts: list[dict], ids: list[str]) -> list[dict]:
    chosen = []
    for want in ids:
        match = [d for d in drafts if d.get("id") == want or str(d.get("id", "")).rsplit("-", 1)[-1] == want]
        if len(match) != 1:
            raise ValueError(f"초안 {want}을(를) 찾지 못했습니다")
        chosen.append(match[0])
    return chosen


def build(drafts: list[dict], ids: list[str], queue: list[dict], start: datetime) -> list[dict]:
    chosen = pick(drafts, ids)
    for kind in {shop_of(d) for d in chosen} & SHOPS.keys():
        if sum(shop_of(d) == kind for d in chosen) > SHOPS[kind]["cap"]:
            raise ValueError(f"{kind} 글은 하루 최대 {SHOPS[kind]['cap']}개입니다")
    existing = {it.get("id") for it in queue}
    problems = []
    for d in chosen:
        if d["id"] in existing:
            problems.append(f"{d['id']}: 이미 예약 목록에 있음")
        elif problem := problem_of(d):
            problems.append(f"{d['id']}: {problem}")
    if problems:
        raise ValueError("넣지 않았습니다 — " + "; ".join(problems))
    last = start + GAP * (len(chosen) - 1)
    if last - start > MAX_SESSION - LEAD:
        raise ValueError("시각이 push 실행 대기 시간(320분)을 넘습니다")
    new = [{**{k: d[k] for k in QUEUE_FIELDS if k in d and k != "publish_at"},
            "publish_at": (start + GAP * i).isoformat(timespec="minutes"), "status": READY}
           for i, d in enumerate(chosen)]
    return queue + new


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=QUEUE_PATH.parent.parent, capture_output=True, text=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("drafts")
    parser.add_argument("--ids", required=True)
    parser.add_argument("--start")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if git("pull", "--ff-only").returncode != 0:
        print("최신 저장소를 받지 못했습니다(git pull 실패).", file=sys.stderr)
        return 1
    drafts = json.loads(Path(args.drafts).read_text(encoding="utf-8"))
    ids = [s.strip() for s in args.ids.split(",") if s.strip()]
    try:
        minute = 40 if all(shop_of(d) == KAKAO for d in pick(drafts, ids)) else 10
        start = datetime.fromisoformat(args.start).replace(tzinfo=KST) if args.start else first_slot(datetime.now(KST), minute)
        queue = build(drafts, ids, load_queue(QUEUE_PATH), start)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1
    added = queue[len(load_queue(QUEUE_PATH)):]
    for it in added:
        print(f"{it['publish_at']}  {it['id']}  {it['text'].splitlines()[0]}")
    if args.dry_run:
        print("(dry-run: 저장하지 않음)")
        return 0
    save_queue(queue, QUEUE_PATH)
    git("add", "--", str(QUEUE_PATH), *[it["video"] for it in added if it.get("video")])  # 영상도 같이 올려야 Pages 주소가 생긴다
    msg = f"chore: pick.haru 예약 {len(added)}개 ({added[0]['publish_at'][:10]})"
    if git("commit", "-m", msg).returncode != 0 or git("push").returncode != 0:
        print("커밋·푸시에 실패했습니다. 예약 목록 파일을 확인하세요.", file=sys.stderr)
        return 1
    print(f"{len(added)}개 예약 완료 — GitHub가 시각마다 올립니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
