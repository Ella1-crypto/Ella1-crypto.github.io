"""릴스·클립 텔레그램 알림을 늘 같은 모양으로 만든다 (2026-11-23 사용자 "이런 식으로 항상 왔으면 좋겠어").

두 가지를 만든다.
  schedule  확정해서 예약한 뒤 한 번 보내는 묶음 알림 (①②③ 목록)
  due       예약 시각이 됐을 때 그 한 편만 보내는 알림

큐 항목에 넣는 것 (없으면 그 줄을 건너뛴다):
  "label":  사람이 읽는 제목.  예) "시나모롤 하트 무드등 v4"   없으면 id로 대신한다
  "music":  {"top": "곡 · 아티스트", "alt": "곡 · 아티스트", "search": "검색어, 검색어"}
  "memo":   올릴 때 손이 가는 것 한 줄.  예) "플로우 장면이라 올릴 때 인스타 'AI 정보' 켜기"

쓰는 법
  python3 reel_notice.py schedule --title "카카오 확정 릴스" rl-kakao-098-cinna-lamp rl-kakao-handcream-egg
  python3 reel_notice.py schedule --upcoming            # 예약 중인 직접 게시 릴스 전부
  python3 reel_notice.py due rl-kakao-098-cinna-lamp
  ... --outbox 를 붙이면 data/telegram/outbox/ 에 파일로 쓴다(맥에서 켜 둔 봇이 30초 안에 보냄).
  안 붙이면 그냥 찍어 준다.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
HERE = Path(__file__).resolve().parent
IG_QUEUE = HERE / "pickharu-ig-queue.json"
SITE_URL = "https://ella1-crypto.github.io/"
OUTBOX = Path.home() / "sns" / "pickharu" / "data" / "telegram" / "outbox"

CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮"
WEEKDAY = "월화수목금토일"

# 2026-11-16 사용자: 릴스는 auto 아님 · 음악은 사용자가 앱에서 고른다. 그 아래 한 줄은 늘 같이 간다.
VOLUME_RULE = ("음악은 10~20%, 원본 소리(목소리) 100%. "
               "상업 곡이 회색이면 검색어로 라이브러리 곡, ↗ 붙은 곡 우선.")


def load(path: Path = IG_QUEUE) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return data["items"] if isinstance(data, dict) else data


def when(item: dict) -> datetime | None:
    stamp = item.get("publish_at")
    if not stamp:
        return None
    at = datetime.fromisoformat(stamp)
    return at if at.tzinfo else at.replace(tzinfo=KST)


def label_of(item: dict) -> str:
    return (item.get("label") or "").strip() or item["id"]


def page_of(item: dict, site_url: str = SITE_URL) -> str:
    page = item.get("page", "")
    return site_url + page.removesuffix("index.html") if page else ""


def when_text(item: dict) -> str:
    at = when(item)
    if not at:
        return ""
    at = at.astimezone(KST)
    return f"{at.month}/{at.day}({WEEKDAY[at.weekday()]}) {at:%H:%M}"


def music_line(item: dict) -> str:
    m = item.get("music") or {}
    parts = [f"1순위 {m['top']}"] if m.get("top") else []
    if m.get("alt"):
        parts.append(f"대안 {m['alt']}")
    if m.get("search"):
        parts.append(f"검색어 {m['search']}")
    return "🎵 " + " / ".join(parts) if parts else ""


def entry(item: dict, mark: str, site_url: str = SITE_URL) -> str:
    """①  11/21(토) 12:30 제목 → 주소 / 🎵 ... / 메모: ..."""
    head = " ".join(x for x in (mark, when_text(item), label_of(item)) if x)
    page = page_of(item, site_url)
    lines = [f"{head} → {page}" if page else head]
    line = music_line(item)
    if line:
        lines.append(line)
    if (item.get("memo") or "").strip():
        lines.append(f"메모: {item['memo'].strip()}")
    return "\n".join(lines)


def schedule_notice(items: list[dict], title: str = "확정 릴스", site_url: str = SITE_URL) -> str:
    """①②③ 묶음 알림. 사용자가 보여 준 모양 그대로."""
    items = sorted(items, key=lambda it: when(it) or datetime.max.replace(tzinfo=KST))
    head = f"📸 {title} {len(items)}편 예약 (모두 직접 게시 · 그 시각에 알림)"
    blocks = [entry(it, CIRCLED[i] if i < len(CIRCLED) else f"{i + 1}.", site_url)
              for i, it in enumerate(items)]
    return "\n\n".join([head, *blocks, VOLUME_RULE])


def due_notice(item: dict, site_url: str = SITE_URL) -> str:
    """예약 시각에 그 한 편만. 묶음 알림과 같은 줄 모양을 쓴다."""
    first = (item.get("caption", "").strip().splitlines() or [""])[0][:60]
    lines = [f"🎬 지금 올릴 차례 · {label_of(item)}"]
    if first:
        lines.append(first)
    page = page_of(item, site_url)
    if page:
        lines.append(f"영상 저장·캡션 복사 👉 {page}")
    line = music_line(item)
    if line:
        lines.append(line)
    if (item.get("memo") or "").strip():
        lines.append(f"메모: {item['memo'].strip()}")
    lines.append("인스타 앱에서 음악 골라 올린 뒤 첫 댓글을 붙여 주세요.")
    lines.append(VOLUME_RULE)
    return "\n".join(lines)


def upcoming(items: list[dict], now: datetime | None = None) -> list[dict]:
    """아직 안 올린 직접 게시 릴스(예약 상태 · auto 아님 · 영상 있음)."""
    now = now or datetime.now(KST)
    out = []
    for it in items:
        at = when(it)
        if it.get("status") != "예약" or it.get("auto") is True or "video" not in it or not at:
            continue
        if at >= now - timedelta(hours=1):
            out.append(it)
    return out


CLIP_DIR = Path.home() / "Documents" / "claude-work" / "naver-clip" / "20261116_블로그짝클립"


def clip_info(path: Path) -> dict:
    """클립 업로드 칸 파일(<이름>_info.py)의 D 를 읽는다. 우리가 쓴 파일만 넣는다."""
    scope: dict = {}
    exec(compile(path.read_text(encoding="utf-8"), str(path), "exec"), scope)  # noqa: S102
    return scope["D"]


def clip_entry(info: dict, mark: str) -> str:
    lines = [f"{mark} {info.get('name') or info.get('title', '')}"]
    for key, tag in (("mp4", "파일"), ("title", "제목"), ("blog", "짝 블로그")):
        if info.get(key):
            lines.append(f"   {tag} {info[key]}")
    tags = info.get("tags")
    if tags:
        lines.append("   태그 " + " ".join("#" + t for t in tags))
    if info.get("ai"):
        lines.append(f"   AI 활용 {info['ai']}")
    return "\n".join(lines)


def clip_notice(infos: list[dict], title: str = "네이버 클립") -> str:
    """릴스 묶음 알림과 같은 모양. 클립은 음악 추천이 없어서 🎵 줄만 빠진다."""
    head = f"🎬 {title} {len(infos)}편 (올릴 순서대로)"
    blocks = [clip_entry(info, CIRCLED[i] if i < len(CIRCLED) else f"{i + 1}.")
              for i, info in enumerate(infos)]
    return "\n\n".join([head, *blocks,
                        "제목 40자 · 정보 300자 · 태그 10개 · AI 활용 표기까지 txt 그대로예요. "
                        "클립엔 [광고] 표기를 넣지 않습니다."])


def write_outbox(text: str, name: str, outbox: Path = OUTBOX) -> Path:
    outbox.mkdir(parents=True, exist_ok=True)
    path = outbox / f"{datetime.now(KST):%Y%m%d-%H%M%S}-{name}.txt"
    path.write_text(text + "\n", encoding="utf-8")
    return path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("schedule", help="①②③ 묶음 알림")
    s.add_argument("ids", nargs="*", help="큐 항목 id (없으면 --upcoming 을 쓴다)")
    s.add_argument("--title", default="확정 릴스")
    s.add_argument("--upcoming", action="store_true", help="예약 중인 직접 게시 릴스 전부")
    s.add_argument("--outbox", action="store_true")
    s.add_argument("--queue", type=Path, default=IG_QUEUE)

    d = sub.add_parser("due", help="그 시각에 한 편만")
    d.add_argument("id")
    d.add_argument("--outbox", action="store_true")
    d.add_argument("--queue", type=Path, default=IG_QUEUE)

    c = sub.add_parser("clip", help="네이버 클립 올릴 순서")
    c.add_argument("names", nargs="+", help="업로드 칸 파일 이름 (mj11 또는 mj11_info.py 또는 전체 경로)")
    c.add_argument("--title", default="네이버 클립")
    c.add_argument("--dir", type=Path, default=CLIP_DIR / "_scripts" / "specs")
    c.add_argument("--outbox", action="store_true")

    args = ap.parse_args(argv)

    if args.cmd == "clip":
        paths = []
        for name in args.names:
            p = Path(name)
            if not p.is_absolute():
                p = args.dir / (name if name.endswith("_info.py") else f"{name}_info.py")
            paths.append(p)
        text = clip_notice([clip_info(p) for p in paths], args.title)
        if args.outbox:
            print(f"보냄: {write_outbox(text, 'clip-order')}")
        print(text)
        return 0

    items = load(args.queue)
    by_id = {it["id"]: it for it in items}

    if args.cmd == "schedule":
        chosen = upcoming(items) if (args.upcoming or not args.ids) else [by_id[i] for i in args.ids]
        if not chosen:
            print("보낼 릴스 없음")
            return 0
        text = schedule_notice(chosen, args.title)
        name = "reel-schedule"
    else:
        text = due_notice(by_id[args.id])
        name = f"reel-due-{args.id}"

    if args.outbox:
        print(f"보냄: {write_outbox(text, name)}")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
