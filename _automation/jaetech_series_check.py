"""heeya 자동 연재 빈자리 검사 (2026-11-03 사용자 "안꺼지게 자동으로 해줘", "텔레그램으로 알림 잘 보내주고").

연재 글은 PC의 예약 작업(Claude 앱)이 써서 jaetech-queue.json 에 넣는다. PC가 자거나 앱이 꺼져 있으면 그날 작업이 건너뛰어진다.
GitHub Actions(.github/workflows/series-check.yml)가 매일 낮에 이 검사를 돌려, 비어 있는 자리가 있으면
@Threads_heeyadailyfit_bot 으로 알린다(Secrets HEEYA_TELEGRAM_TOKEN·HEEYA_TELEGRAM_CHAT_ID). 표준 라이브러리만 쓴다.

기대하는 자리(오늘 = 검사하는 날, KST):
- 재테크 한 줄: 오늘 jt- 글 1개 (작업 11:09 → 13:00 예약)
- AI 노하우: 내일 ai- 글 2개 (09:30·20:30)
- 무료강의: 내일 r2- 글 1개 (07:30)
"""
from __future__ import annotations

import os
import re
import sys
from datetime import date, datetime, timedelta

from jaetech_publish import KST, QUEUE_PATH, http_json, load_queue

SLOTS = (  # (이름, id 모양, 며칠 뒤, 필요한 개수, 다시 돌릴 예약 작업)
    ("재테크 한 줄", re.compile(r"jt-\d{8}"), 0, 1, "jaetech-one-liner"),
    ("AI 노하우", re.compile(r"ai-\d{8}"), 1, 2, "ai-knowhow-series"),
    ("무료강의", re.compile(r"r2-\d{8}"), 1, 1, "free-course-series"),
)
LIVE = {"예약", "올리는 중", "올림"}


def day_of(item: dict) -> date | None:
    try:
        return datetime.fromisoformat(item["publish_at"]).astimezone(KST).date()
    except (KeyError, ValueError):
        return None


def missing(items: list[dict], today: date) -> list[str]:
    """비어 있는 자리 설명 목록. id 모양이 맞는 글만 센다(r2-ai-… 는 무료강의·AI 어느 쪽에도 안 셈)."""
    out = []
    for name, shape, ahead, need, task in SLOTS:
        day = today + timedelta(days=ahead)
        have = sum(1 for it in items if shape.match(it.get("id", "")) and it.get("status") in LIVE
                   and day_of(it) == day)
        if have < need:
            out.append(f"• {name} {day:%m/%d}: {have}/{need}개 — '{task}' 다시 돌리기")
    return out


def message(gaps: list[str], today: date) -> str:
    return "\n".join([f"⚠️ heeya 연재 빈자리 ({today:%m/%d} 점검)",
                      "PC 예약 작업이 안 돈 것 같아요(PC 잠자기·앱 꺼짐).", *gaps,
                      "", "PC를 켜고 heeya 세션에 \"빈자리 채워줘\"라고 보내 주세요."])


def send(text: str, http=http_json) -> bool:
    bot = os.environ.get("HEEYA_TELEGRAM_TOKEN", "").strip()
    chat = os.environ.get("HEEYA_TELEGRAM_CHAT_ID", "").strip()
    if not bot or not chat:
        print("::warning::HEEYA_TELEGRAM Secrets 없음 — 알림 못 보냄", flush=True)
        return False
    http("POST", f"https://api.telegram.org/bot{bot}/sendMessage", {"chat_id": chat, "text": text})
    return True


def main() -> int:
    today = datetime.now(KST).date()
    gaps = missing(load_queue(QUEUE_PATH), today)
    if not gaps:
        print("빈자리 없음")
        return 0
    text = message(gaps, today)
    print(text)
    send(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
