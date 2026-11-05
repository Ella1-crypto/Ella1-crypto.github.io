"""사용자가 고른 pick.haru 초안만 예약 목록(pickharu-queue.json)에 넣고 커밋·푸시한다.

사용: python pickharu_enqueue.py <drafts/날짜.json> --ids 1,3,5 [--start 2026-10-28T17:10] [--dry-run]
- 카카오 초안 파일(drafts/kakao-날짜.json, kind "카카오")도 같은 방법. 카카오 글은 :40분, 네이버 글(drafts/naver-날짜.json)은 :25분에 넣어 쿠팡(:10분)과 겹치지 않게 한다.
- id는 초안 id의 끝 번호(ph-20261028-3 → 3) 또는 전체 id.
- 시각(2026-10-30 사용자 운영안): --start가 없으면 종류별 하루 자리(DAY_SLOTS) 중 비어 있는 가장 이른 자리에 넣는다.
  쿠팡 12:10·15:10, 카카오(:40)·네이버(:25)는 쿠팡 사이 13시·16시·19시를 나눠 쓰고, 일반(비광고) 글은 08:30·20:30.
  오늘 자리가 다 차면 다음 날로 넘어간다. --start를 주면 예전처럼 그 시각부터 1시간 간격(320분 안).
- 검사(pickharu_publish.problem_of)를 하나라도 통과 못 하면 아무것도 넣지 않는다.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

from jaetech_publish import DONE, IN_PROGRESS, KST, READY, load_queue, save_queue
from pickharu_publish import (
    COUPANG, FOLLOWUP, GENERAL, INFO, KAKAO, MAX_SESSION, NAVER, OLIVEYOUNG, OY_BF_END, QUEUE_PATH, SHOPS, cap_of,
    problem_of, shop_of, total_cap,
)

QUEUE_FIELDS = ("id", "kind", "publish_at", "text", "reply", "thread", "keyword", "product", "video", "images", "gif", "quote_of", "expires_at")
GAP = timedelta(hours=1)
LEAD = timedelta(minutes=20)
SLOT_MINUTE = {KAKAO: 40, NAVER: 25, OLIVEYOUNG: 50}  # 종류별 예약 분(쿠팡 :10분과 안 겹치게)
# 종류별 하루 자리(시, 분). 쿠팡과 카카오·네이버가 번갈아 올라가게 한다(2026-10-30 사용자 운영안).
DAY_SLOTS = {
    GENERAL: [(8, 30), (20, 30)],
    COUPANG: [(12, 10), (15, 10)],
    KAKAO: [(13, 40), (16, 40), (19, 40)],
    NAVER: [(13, 25), (16, 25), (19, 25)],
    OLIVEYOUNG: [(12, 50), (17, 50)],  # 2026-11-02 사용자: 점심·퇴근길 하루 2개까지
    INFO: [(10, 55), (14, 55), (18, 55), (21, 55)],  # 소식 글(2026-11-03). 시간이 중요한 글은 초안의 publish_at을 쓴다
}
FIXED_LEAD = timedelta(minutes=5)  # 소식 글의 제안 시각(publish_at)은 Accept 시점보다 이만큼은 뒤여야 한다
# 블프(~11/7)엔 올영 자리를 4개로(2026-11-02 사용자 "블프 전에 다 올려야 돼")
OY_BF_SLOTS = [(12, 50), (15, 50), (17, 50), (21, 10)]
# 2026-11-05 사용자 "카카오·네이버는 주 3회·하루 1개": 11/8부터 카카오 화·목·토 19:40, 네이버 월·수·금 19:25 (월=0)
ALLOWED_WEEKDAYS = {KAKAO: {1, 3, 5}, NAVER: {0, 2, 4}}
GIFT_SLOTS = {KAKAO: [(19, 40)], NAVER: [(19, 25)]}
SLOT_GROUP = {KAKAO: "제휴", NAVER: "제휴"}  # 카카오·네이버는 같은 시간대를 나눠 쓴다(한 시간에 하나)
TAKES_SLOT = (READY, IN_PROGRESS, DONE)  # 보류·취소·실패 글은 자리를 차지하지 않는다
PLAN_DAYS = 7


def first_slot(now: datetime, minute: int = 10) -> datetime:
    """지금+20분 이후 첫 :minute분."""
    at = (now + LEAD).replace(second=0, microsecond=0)
    at = at.replace(minute=minute) if at.minute <= minute else (at + timedelta(hours=1)).replace(minute=minute)
    return at


def plan_times(kind: str, count: int, queue: list[dict], now: datetime) -> list[datetime]:
    """kind 글 count개를 넣을 자리: 지금+20분 이후, 같은 무리(카카오·네이버는 함께)가 안 쓴 가장 이른 시간대부터."""
    group = SLOT_GROUP.get(kind, kind)
    taken = {str(it.get("publish_at", ""))[:13] for it in queue
             if SLOT_GROUP.get(shop_of(it), shop_of(it)) == group and it.get("status") in TAKES_SLOT}
    per_day: dict[str, int] = {}  # 날짜별로 이미 잡힌 글 수(덧글 제외) — 하루 전체 상한용
    for it in queue:
        if it.get("kind") != FOLLOWUP and it.get("status") in TAKES_SLOT:
            day_key = str(it.get("publish_at", ""))[:10]
            per_day[day_key] = per_day.get(day_key, 0) + 1
    times = []
    today = now.astimezone(KST).date()
    for offset in range(PLAN_DAYS):
        day = today + timedelta(days=offset)
        limit = total_cap(datetime(day.year, day.month, day.day, tzinfo=KST))
        slots = OY_BF_SLOTS if kind == OLIVEYOUNG and day <= OY_BF_END else DAY_SLOTS[kind]
        if limit is not None and kind in ALLOWED_WEEKDAYS:
            if day.weekday() not in ALLOWED_WEEKDAYS[kind]:
                continue
            slots = GIFT_SLOTS[kind]
        for hour, minute in slots:
            at = datetime(day.year, day.month, day.day, hour, minute, tzinfo=KST)
            key = at.isoformat()[:13]
            if at < now + LEAD or key in taken:
                continue
            if limit is not None and per_day.get(day.isoformat(), 0) >= limit:
                break
            times.append(at)
            taken.add(key)
            per_day[day.isoformat()] = per_day.get(day.isoformat(), 0) + 1
            if len(times) == count:
                return times
    raise ValueError(f"{kind} 글을 넣을 빈 자리가 {PLAN_DAYS}일 안에 없습니다")


def pick(drafts: list[dict], ids: list[str]) -> list[dict]:
    chosen = []
    for want in ids:
        match = [d for d in drafts if d.get("id") == want or str(d.get("id", "")).rsplit("-", 1)[-1] == want]
        if len(match) != 1:
            raise ValueError(f"초안 {want}을(를) 찾지 못했습니다")
        chosen.append(match[0])
    return chosen


def build(drafts: list[dict], ids: list[str], queue: list[dict], start: datetime | None = None,
          now: datetime | None = None) -> list[dict]:
    chosen = pick(drafts, ids)
    now = now or datetime.now(KST)
    for kind in {shop_of(d) for d in chosen} & (SHOPS.keys() | {INFO}):
        cap = cap_of(kind, now)
        if sum(shop_of(d) == kind for d in chosen) > cap:
            raise ValueError(f"{kind} 글은 하루 최대 {cap}개입니다")
    existing = {it.get("id") for it in queue}
    problems = []
    for d in chosen:
        if d["id"] in existing:
            problems.append(f"{d['id']}: 이미 예약 목록에 있음")
        elif problem := problem_of(d):
            problems.append(f"{d['id']}: {problem}")
    if problems:
        raise ValueError("넣지 않았습니다 — " + "; ".join(problems))
    if start is not None:
        if GAP * (len(chosen) - 1) > MAX_SESSION - LEAD:
            raise ValueError("시각이 push 실행 대기 시간(320분)을 넘습니다")
        times = [start + GAP * i for i in range(len(chosen))]
    else:
        fixed = {d["id"]: kst(d["publish_at"]) for d in chosen if d.get("kind") == INFO and d.get("publish_at")}
        free = [d for d in chosen if d["id"] not in fixed]
        # 종류를 하나씩 잡으면서 앞에서 잡은 자리를 다음 종류 계산에 넣어 하루 전체 상한이 한 번에 넘치지 않게 한다
        work = list(queue) + [{"kind": d.get("kind"), "publish_at": fixed[d["id"]].isoformat(), "status": READY}
                              for d in chosen if d["id"] in fixed]
        planned = {}
        for kind in sorted({shop_of(d) for d in free}):
            kind_times = plan_times(kind, sum(shop_of(d) == kind for d in free), work, now)
            planned[kind] = iter(kind_times)
            work += [{"kind": kind, "publish_at": t.isoformat(), "status": READY} for t in kind_times]
        times = [fixed.get(d["id"]) or next(planned[shop_of(d)]) for d in chosen]
        for d, at in zip(chosen, times):
            if d["id"] in fixed and at < now + FIXED_LEAD:
                raise ValueError(f"{d['id']}: 제안 시각 {at:%m/%d %H:%M}이 지났어요 — 시각을 바꿔 다시 보내 주세요")
    for d, at in zip(chosen, times):
        if d.get("expires_at") and at >= kst(d["expires_at"]):
            raise ValueError(f"{d['id']}: 예약 시각 {at:%m/%d %H:%M}이 소식 마감 {kst(d['expires_at']):%m/%d %H:%M} 뒤예요")
    new = [{**{k: d[k] for k in QUEUE_FIELDS if k in d and k != "publish_at"},
            "publish_at": at.isoformat(timespec="minutes"), "status": READY}
           for d, at in zip(chosen, times)]
    return queue + new


def kst(stamp: str) -> datetime:
    at = datetime.fromisoformat(stamp)
    return at if at.tzinfo else at.replace(tzinfo=KST)


def git(*args: str) -> subprocess.CompletedProcess:
    # git 출력은 UTF-8(한글 커밋 메시지). Windows 기본 cp949로 읽으면 UnicodeDecodeError가 난다(11/3 텔레그램 Accept 때)
    return subprocess.run(["git", *args], cwd=QUEUE_PATH.parent.parent, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")


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
        start = datetime.fromisoformat(args.start).replace(tzinfo=KST) if args.start else None
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
    media = [it["video"] for it in added if it.get("video")] + [m for it in added for m in it.get("images") or []]
    git("add", "--", str(QUEUE_PATH), *media)  # 영상·사진도 같이 올려야 Pages 주소가 생긴다
    msg = f"chore: pick.haru 예약 {len(added)}개 ({added[0]['publish_at'][:10]})"
    if git("commit", "-m", msg).returncode != 0 or git("push").returncode != 0:
        print("커밋·푸시에 실패했습니다. 예약 목록 파일을 확인하세요.", file=sys.stderr)
        return 1
    print(f"{len(added)}개 예약 완료 — GitHub가 시각마다 올립니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
