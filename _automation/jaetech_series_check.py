"""heeya 자동 연재 빈자리 검사 (2026-11-03 사용자 "안꺼지게 자동으로 해줘", "텔레그램으로 알림 잘 보내주고").

연재 글은 PC의 예약 작업(Claude 앱)이 써서 jaetech-queue.json 에 넣는다. PC가 자거나 앱이 꺼져 있으면 그날 작업이 건너뛰어진다.
GitHub Actions(.github/workflows/series-check.yml)가 매일 낮에 이 검사를 돌려, 비어 있는 자리가 있으면
@Threads_heeyadailyfit_bot 으로 알린다(Secrets HEEYA_TELEGRAM_TOKEN·HEEYA_TELEGRAM_CHAT_ID). 표준 라이브러리만 쓴다.

기대하는 자리(오늘 = 검사하는 날, KST):
- 재테크 한 줄: 오늘 jt- 글 1개 (작업 11:09 → 13:00 예약)
- AI 노하우: 내일 ai- 글 1개 (09:30) — 2026-11-05 운영 전략 「하루 2→1」
- 무료강의: 내일 r2- 글 1개 (07:30)
"""
from __future__ import annotations

import os
import json
from pathlib import Path
import re
import sys
from datetime import date, datetime, timedelta

from jaetech_publish import KST, QUEUE_PATH, http_json, load_queue

SLOTS = (  # (이름, id 모양, 며칠 뒤, 필요한 개수, 다시 돌릴 예약 작업)
    ("재테크 한 줄", re.compile(r"jt-\d{8}"), 0, 1, "jaetech-one-liner"),
    # 11/10부터 AI 노하우 영상 연재는 ai-video-NN id를 쓴다(11/12 가짜 경보로 추가). r2-ai-… 는 앞이 r2- 라 안 맞음.
    ("AI 팁·사용법", re.compile(r"ai-(\d{8}|video-\d+)"), 1, 1, "ai-knowhow-series"),
    ("AI 영상 만들기", re.compile(r"r2-\d{8}"), 1, 1, "free-course-series"),
)
LIVE = {"예약", "올리는 중", "올림"}


def day_of(item: dict) -> date | None:
    try:
        return datetime.fromisoformat(item["publish_at"]).astimezone(KST).date()
    except (KeyError, ValueError):
        return None


def category_matches(item: dict, name: str, day: date) -> bool:
    if day < date(2026, 11, 27) or name == "재테크 한 줄":
        return True
    return item.get("series_category") == name


def editorial_gaps(items: list[dict], today: date, calendar=None) -> list[str]:
    """Read-only readiness audit; a queue entry is neither a draft nor proof of publication."""
    if calendar is None:
        calendar = json.loads(Path(__file__).with_name("editorial_calendar.json").read_text())
    day = today + timedelta(days=1)
    transition = day < date.fromisoformat(calendar["effective_from"])
    source = calendar.get("transition", {}).get("days", []) if transition else calendar["slots"]
    expected = [s for s in source if s["date"] == day.isoformat()]
    if not expected:
        return [f"• {day:%m/%d} 편성표 없음 — 제작 기준 갱신 필요 (정상 처리 아님)"]
    out = []
    for slot in expected:
        label = f"{day:%m/%d} {slot.get('topic_brief', slot['series_category'])}"
        rows = [it for it in items if it.get("editorial_slot") == slot["editorial_slot"]
                and it.get("topic_key") == slot["topic_key"]
                and it.get("channel", "threads-heeya") in {"threads-heeya", "threads_heeya"}]
        live = [it for it in rows if it.get("status") in LIVE and day_of(it) == day]
        if len(live) > 1:
            out.append(f"• heeya {label}: 중복 큐 {len(live)}건 — 자동 재생성 금지")
        elif live:
            it = live[0]
            if it.get("status") == "올림" and not (it.get("post_id") and it.get("published_at")):
                out.append(f"• heeya {label}: 올림 표시지만 게시 ID/시각 증거 미확인")
            elif it.get("status") == "올리는 중":
                out.append(f"• heeya {label}: 처리 중 — 결과 조회 먼저, 재게시 금지")
        elif rows:
            states = ', '.join(sorted({str(it.get('status', '미확인')) for it in rows}))
            out.append(f"• heeya {label}: {states} — 제작/검수/승인 상태 확인, 예약 아님")
        else:
            out.append(f"• heeya {label}: 정렬된 준비물·예약 큐 미확인 — 블로그 기준 제작 필요")
        conflicts = [it for it in items if day_of(it) == day and it.get('status') in LIVE
                     and it.get('topic_key') != slot['topic_key']]
        for it in conflicts:
            out.append(f"• 기존 큐 {it.get('id')}: {it.get('status')} / {it.get('topic_key', '소재 미기록')} — 공통소재와 다름, 임의 변경·취소 금지")
        ig = slot.get('channels', {}).get('instagram', {})
        ig_state = {'preparation_required': '제작·검수 준비 필요', 'planned': '기획만 있음'}.get(ig.get('status'), ig.get('status', '준비 상태 미확인'))
        # This script cannot read Instagram's native schedule or publishing API.
        out.append(f"• 인스타 {label}: {ig_state} — 릴스·표지·캡션·첫댓글·음악·검수전달 증거 별도 점검")
    if transition:
        out.append("• 전환기: 블로그 예약 유지, 인스타 메인 1편 기획. 추가 블로그 글을 전부 피드로 복제하지 않음")
        for draft in calendar.get('transition', {}).get('retained_drafts', []):
            if day.isoformat().replace('-', '') in draft['id']:
                out.append(f"• 보존 초안 {draft['id']}: {draft['note']}")
    return out


def missing(items: list[dict], today: date) -> list[str]:
    """비어 있는 자리 설명 목록. id 모양이 맞는 글만 센다(r2-ai-… 는 무료강의·AI 어느 쪽에도 안 셈)."""
    if today >= date(2026, 11, 26):
        return editorial_gaps(items, today)
    out = []
    for name, shape, ahead, need, task in SLOTS:
        day = today + timedelta(days=ahead)
        have = sum(1 for it in items if shape.match(it.get("id", "")) and it.get("status") in LIVE
                   and day_of(it) == day and category_matches(it, name, day))
        if have < need:
            out.append(f"• {name} {day:%m/%d}: {have}/{need}개 — '{task}' 다시 돌리기")
    return out


def message(gaps: list[str], today: date) -> str:
    return "\n".join([f"🧭 블로그·heeya·인스타 준비 점검 ({today:%m/%d})",
                      "예약 누락·제작 대기·소재 충돌을 구분한 결과입니다. 예약과 실제 발행은 별도입니다.", *gaps,
                      "", "기존 승인 예약은 유지합니다. 새 글은 영상/원고·캡션·음악·방식·시각 검수와 최종확정 후 예약합니다.",
                      "예약 작업 재실행이나 확정 버튼을 반복하지 마세요. 미완료 항목은 준비 작업으로 이어갑니다."])



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
    if "--dry-run" not in sys.argv:
        send(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
