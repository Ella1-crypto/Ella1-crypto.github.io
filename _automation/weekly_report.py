"""4계정 주간 성과 보고서 — metrics/daily 스냅샷 + 큐 + 블로그 RSS로 지난주(월~일, KST) 보고서를 만든다.

사용:
  python3 weekly_report.py [--week-ending 2026-11-08] [--out-dir ~/Documents/claude-work/reports]
                           [--outbox ~/sns/pickharu/data/telegram/outbox] [--no-telegram] [--print]
- 기본 주: 오늘 기준 '지난주'(오늘이 월요일이면 바로 전 월~일).
- 결과: <out-dir>/<보고일 YYYY-MM-DD>-weekly.md (전체), <outbox>/<보고일>-weekly.txt (텔레그램 요약 3,500자 이하,
  켜져 있는 telegram_drafts.py serve가 보낸다). --no-telegram이면 outbox 파일을 만들지 않는다.
- 숫자는 스냅샷에 있는 값만 쓴다. 없으면 '없음'/'앱에서 확인'으로 적고 추측하지 않는다.
계정: Threads @pick.haru__1 · Threads @heeya.dailyfit · Instagram @pick.haru.daily · 네이버 블로그 goghibli(RSS 목록만, 조회수는 앱에서 확인)
표준 라이브러리만 쓴다. 게시·예약·큐 수정은 하지 않는다.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path

from metrics_collect import ACCOUNTS, DAILY_DIR, HERE, KST, PUBLISHED, first_line, item_time, parse_time

BLOG_RSS = "https://rss.blog.naver.com/goghibli.xml"
BLOG_URL = "https://blog.naver.com/goghibli"
TELEGRAM_LIMIT = 3500
DEFAULT_OUT = Path.home() / "Documents" / "claude-work" / "reports"
DEFAULT_OUTBOX = Path.home() / "sns" / "pickharu" / "data" / "telegram" / "outbox"
ACCOUNT_ORDER = ["threads-pickharu", "threads-heeya", "ig-pickharu"]
ACCOUNT_TITLE = {"threads-pickharu": "Threads @pick.haru__1", "threads-heeya": "Threads @heeya.dailyfit",
                 "ig-pickharu": "Instagram @pick.haru.daily", "blog": "네이버 블로그 goghibli"}
SERIES_ORDER = ["연말정산", "AI 노하우", "무료강의", "마음 10분", "쇼핑·광고", "세일 소식", "일상", "기타"]
# (시리즈, id 정규식, 본문 첫 줄 정규식) — 위에서부터 처음 맞는 것
SERIES_RULES = [
    ("연말정산", r"^(ig|rl)-(yt|clip-jt|hometown|tint-hometown|tintkeep-hometown)|^jt-|bf-tax", r"연말정산|고향사랑기부"),
    ("AI 노하우", r"aitip|^ai-|clip-ai", r"AI 노하우|챗GPT|ChatGPT|생성형 AI"),
    ("무료강의", r"^r2-|^fc-|free-course|^(ig|rl)-(free|course)", r"무료 ?강의"),
    ("마음 10분", r"^maeum-", r"나를 위한 10분|마음 10분"),
    ("쇼핑·광고", r"-ad-|^ad-|^ph-|^kk-|^nv-|^oy-|^tg-|^fashion-|shop|haul|bf-size|coat|pepero|kitty|ganadi|xmas|skims|oy-|daiso|inpock",
     r"\[광고\]|\(광고\)|쿠팡|인포크|세일 중"),
    ("세일 소식", r"^if-|sale", r"세일|블프"),
]
KIND_SERIES = {"카카오": "쇼핑·광고", "올영": "쇼핑·광고", "네이버": "쇼핑·광고", "쿠팡": "쇼핑·광고", "쇼핑": "쇼핑·광고", "패션": "쇼핑·광고",
               "정보": "세일 소식", "일반": "일상", "마음": "마음 10분", "강의": "무료강의"}


# ---------- 읽기 ----------

def load_queue(name: str) -> dict[str, dict]:
    path = HERE / ACCOUNTS[name]["queue"]
    try:
        return {i["id"]: i for i in json.loads(path.read_text(encoding="utf-8")) if i.get("id")}
    except (OSError, ValueError):
        return {}


def load_snapshots(name: str) -> list[tuple[str, dict]]:
    """[(날짜, 스냅샷)] 날짜 오름차순."""
    out = []
    for path in sorted(DAILY_DIR.glob(f"*/{name}.json")):
        try:
            out.append((path.parent.name, json.loads(path.read_text(encoding="utf-8"))))
        except (OSError, ValueError):
            continue
    return out


def latest_posts(snaps: list[tuple[str, dict]]) -> dict[str, dict]:
    """글마다 가장 최근 스냅샷 값(+ snapshot_date)."""
    latest: dict[str, dict] = {}
    for date, snap in snaps:
        for post_id, entry in (snap.get("posts") or {}).items():
            if entry.get("metrics") or post_id not in latest:
                latest[post_id] = {**entry, "snapshot_date": date}
    return latest


def followers_at(snaps: list[tuple[str, dict]], on_or_before: str) -> int | None:
    value = None
    for date, snap in snaps:
        if date <= on_or_before and snap.get("profile", {}).get("followers") is not None:
            value = snap["profile"]["followers"]
    return value


def series_of(item_id: str, item: dict) -> str:
    if item.get("ad"):
        return "쇼핑·광고"
    kind = item.get("kind")
    if kind in KIND_SERIES:
        return KIND_SERIES[kind]
    line = first_line(item.get("caption") or item.get("text"))
    for name, id_re, text_re in SERIES_RULES:
        if re.search(id_re, item_id) or re.search(text_re, line):
            return name
    return "기타"


def title_of(item: dict) -> str:
    line = first_line(item.get("caption") or item.get("text"))
    if not line or line.startswith(("이 포스팅은", "[광고]", "(광고)")):  # 고지문이 첫 줄이면 상품명으로
        line = item.get("product") or line or item.get("id", "")
    return line[:40]


def metric(entry: dict, *names: str) -> int | None:
    m = entry.get("metrics") or {}
    for name in names:
        if m.get(name) is not None:
            return int(m[name])
    return None


def engagement(entry: dict, platform: str) -> int:
    m = entry.get("metrics") or {}
    keys = ("likes", "replies", "reposts", "quotes", "shares") if platform == "threads" else ("likes", "comments", "saved", "shares")
    return sum(int(m.get(k) or 0) for k in keys)


def primary(entry: dict, platform: str) -> tuple[int | None, str]:
    """정렬 기준 숫자와 이름. 인스타는 reach가 있으면 reach, 없으면 좋아요+댓글(인사이트 권한 전 임시)."""
    if platform == "threads":
        return metric(entry, "views"), "조회"
    reach = metric(entry, "reach")
    if reach is not None:
        return reach, "도달"
    return engagement(entry, platform), "좋아요+댓글"


def kpi_value(entry: dict, kpi: str, platform: str) -> tuple[float | None, bool]:
    """(값, 임시 여부). 임시 = 인사이트 없이 좋아요+댓글로 대신 계산."""
    m = entry.get("metrics") or {}
    if kpi == "engage_per_view":
        views = m.get("views")
        if not views:
            return None, False
        return engagement(entry, "threads") / views, False
    reach = m.get("reach")
    if reach:
        return (int(m.get("saved") or 0) + int(m.get("shares") or 0)) / reach, False
    if "likes" in m:
        return float(engagement(entry, platform)), True
    return None, False


# ---------- 주 계산 ----------

def week_bounds(week_ending: str | None, today: datetime) -> tuple[datetime, datetime]:
    if week_ending:
        end_day = datetime.strptime(week_ending, "%Y-%m-%d").replace(tzinfo=KST)
        start = (end_day - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        this_monday = (today - timedelta(days=today.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        start = this_monday - timedelta(days=7)
    return start, start + timedelta(days=7)


def in_week(when: datetime | None, start: datetime, end: datetime) -> bool:
    return bool(when) and start <= when.astimezone(KST) < end


# ---------- 계정별 ----------

def account_section(name: str, start: datetime, end: datetime) -> dict:
    spec = ACCOUNTS[name]
    platform = spec["platform"]
    queue = load_queue(name)
    snaps = load_snapshots(name)
    latest = latest_posts(snaps)
    posts = []
    for item_id, item in queue.items():
        if item.get("status") not in PUBLISHED:
            continue
        entry = latest.get(item_id) or {}
        when = parse_time(entry.get("published_at")) or item_time(item)
        if not in_week(when, start, end):
            continue
        value, label = primary(entry, platform)
        posts.append({"id": item_id, "title": title_of(item), "series": series_of(item_id, item), "when": when,
                      "format": entry.get("format") or ("reel" if item_id.startswith("rl-") else "text"),
                      "entry": entry, "primary": value, "primary_label": label, "engage": engagement(entry, platform),
                      "has_metrics": bool(entry.get("metrics")), "permalink": entry.get("permalink"), "test": item.get("test")})
    removed = sum(1 for i in queue.values() if i.get("status") in ("내림", "삭제됨") and in_week(item_time(i), start, end))
    profile_now = snaps[-1][1].get("profile", {}) if snaps else {}
    followers_prev = followers_at(snaps, start.strftime("%Y-%m-%d"))
    unmatched = [u for u in (snaps[-1][1].get("unmatched") or [])
                 if in_week(parse_time(u.get("published_at")), start, end)] if snaps else []
    errors = snaps[-1][1].get("errors", []) if snaps else []
    return {"name": name, "title": ACCOUNT_TITLE[name], "platform": platform, "posts": posts, "removed": removed,
            "followers": profile_now.get("followers"), "followers_prev": followers_prev,
            "profile_views_day": profile_now.get("profile_views_day"), "has_snapshot": bool(snaps),
            "snapshot_date": snaps[-1][0] if snaps else None, "unmatched": unmatched, "errors": errors,
            "token_missing": not snaps}


def blog_section(start: datetime, end: datetime) -> dict:
    items, error = [], ""
    try:
        with urllib.request.urlopen(urllib.request.Request(BLOG_RSS, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as resp:
            root = ET.fromstring(resp.read())
        for node in root.iter("item"):
            pub = node.findtext("pubDate")
            try:
                when = parsedate_to_datetime(pub) if pub else None
            except (TypeError, ValueError):
                when = None
            if in_week(when, start, end):
                link = (node.findtext("link") or "").split("?")[0]
                items.append({"title": (node.findtext("title") or "").strip(), "link": link, "when": when,
                              "category": (node.findtext("category") or "").strip(),
                              "series": series_of("blog", {"text": node.findtext("title") or ""})})
    except Exception as exc:  # RSS가 막혀도 보고서는 나가야 한다
        error = f"RSS 읽기 실패: {type(exc).__name__}"
    items.sort(key=lambda x: x["when"])
    return {"items": items, "error": error}


# ---------- 테스트 보드 ----------

def test_board(start: datetime, end: datetime) -> list[dict]:
    groups: dict[str, dict] = {}
    for name in ACCOUNT_ORDER:
        spec = ACCOUNTS[name]
        queue = load_queue(name)
        latest = latest_posts(load_snapshots(name))
        for item_id, item in queue.items():
            test = item.get("test")
            if not test or item.get("status") in ("취소", "뺌", "실패", "삭제됨", "내림", "보류"):
                continue
            group = groups.setdefault(test.get("group", test.get("variable", "?")), {
                "group": test.get("group"), "variable": test.get("variable"), "hypothesis": test.get("hypothesis"),
                "kpi": test.get("kpi"), "account": ACCOUNT_TITLE[name], "variants": defaultdict(list), "pending": []})
            entry = latest.get(item_id)
            when = parse_time((entry or {}).get("published_at")) or item_time(item)
            published = item.get("status") in PUBLISHED and entry and entry.get("metrics")
            if not published:
                groups[group["group"]]["pending"].append(f"{item_id} ({test.get('variant')}, {when.strftime('%m/%d %H:%M') if when else '?'})")
                continue
            value, provisional = kpi_value(entry, test.get("kpi", ""), spec["platform"])
            days_live = (datetime.now(KST) - when).days if when else None
            group["variants"][test.get("variant")].append({"id": item_id, "value": value, "provisional": provisional,
                                                             "days": days_live, "title": title_of(item)})
    out = []
    for group in groups.values():
        rows = []
        for variant, posts in sorted(group["variants"].items()):
            values = [p["value"] for p in posts if p["value"] is not None]
            rows.append({"variant": variant, "n": len(posts), "mean": sum(values) / len(values) if values else None,
                         "provisional": any(p["provisional"] for p in posts), "posts": posts})
        rows.sort(key=lambda r: (r["mean"] is None, -(r["mean"] or 0)))
        verdict = "표본 부족"
        ready = [r for r in rows if r["mean"] is not None and r["n"] >= 2]
        if len(ready) >= 2:
            top, second = ready[0], ready[1]
            if second["mean"] == 0 or top["mean"] >= second["mean"] * 1.2:
                verdict = f"{top['variant']} 우세 ({top['mean']:.3g} vs {second['mean']:.3g})"
            else:
                verdict = f"차이 작음 ({top['variant']} {top['mean']:.3g} vs {second['variant']} {second['mean']:.3g})"
        elif len(rows) == 1 and rows[0]["mean"] is not None:
            verdict = "비교 상대 없음"
        if any(r["provisional"] for r in rows):
            verdict += " · 임시(좋아요+댓글 기준, 인사이트 권한 전)"
        out.append({**group, "rows": rows, "verdict": verdict})
    out.sort(key=lambda g: g["group"] or "")
    return out


def format_pairs(ig: dict) -> list[dict]:
    """같은 내용의 카드뉴스(ig-X) ↔ 릴스(rl-X) 짝 비교(이번 주 올라간 것만)."""
    by_stem: dict[str, dict] = defaultdict(dict)
    for p in ig["posts"]:
        m = re.match(r"^(ig|rl)-(.+)$", p["id"])
        if m and p["has_metrics"]:
            by_stem[m.group(2)][m.group(1)] = p
    pairs = []
    for stem, both in by_stem.items():
        if "ig" in both and "rl" in both:
            pairs.append({"stem": stem, "carousel": both["ig"], "reel": both["rl"]})
    return pairs


# ---------- 글쓰기 ----------

def fmt(n) -> str:
    return "없음" if n is None else f"{n:,}"


def post_line(p: dict, platform: str) -> str:
    m = p["entry"].get("metrics") or {}
    if platform == "threads":
        detail = f"조회 {fmt(m.get('views'))} · 좋아요 {fmt(m.get('likes'))} · 답글 {fmt(m.get('replies'))} · 리포스트 {fmt(m.get('reposts'))} · 공유 {fmt(m.get('shares'))}"
    else:
        detail = f"좋아요 {fmt(m.get('likes'))} · 댓글 {fmt(m.get('comments'))}"
        if m.get("reach") is not None:
            detail = f"도달 {fmt(m.get('reach'))} · 저장 {fmt(m.get('saved'))} · 공유 {fmt(m.get('shares'))} · 조회 {fmt(m.get('views'))} · " + detail
    link = f" [열기]({p['permalink']})" if p.get("permalink") else ""
    return f"{p['when'].strftime('%m/%d %H:%M')} `{p['id']}` {p['title']} — {detail}{link}"


def top_bottom(posts: list[dict], n: int = 3) -> tuple[list[dict], list[dict]]:
    scored = [p for p in posts if p["primary"] is not None]
    scored.sort(key=lambda p: (-p["primary"], -p["engage"]))
    top = scored[:n]
    bottom = [p for p in reversed(scored) if p not in top][:n]
    return top, bottom


def series_table(accounts: list[dict]) -> list[dict]:
    rows: dict[str, dict] = {}
    for acc in accounts:
        for p in acc["posts"]:
            row = rows.setdefault(p["series"], {"series": p["series"], "n": 0, "by_account": defaultdict(int), "sum": defaultdict(int),
                                                "label": defaultdict(str), "best": None})
            row["n"] += 1
            row["by_account"][acc["title"]] += 1
            if p["primary"] is not None:
                row["sum"][acc["name"]] += p["primary"]
                row["label"][acc["name"]] = p["primary_label"]
                if row["best"] is None or p["primary"] > row["best"]["primary"]:
                    row["best"] = {**p, "account": acc["title"]}
    order = {s: i for i, s in enumerate(SERIES_ORDER)}
    return sorted(rows.values(), key=lambda r: order.get(r["series"], 99))


def build_markdown(start: datetime, end: datetime, accounts: list[dict], blog: dict, tests: list[dict], pairs: list[dict],
                   report_date: str) -> str:
    week = f"{start:%m/%d}~{(end - timedelta(days=1)):%m/%d}"
    L = [f"# 4계정 주간 성과 보고 {week} (작성 {report_date})", ""]
    L.append("숫자는 수집 스냅샷(`_automation/metrics/daily/`)에 있는 값만 적었다. 인스타는 인사이트 권한(instagram_manage_insights)을 받기 전까지 좋아요·댓글만 있다.")
    L.append("")
    L.append("## 한눈에")
    L.append("")
    L.append("| 계정 | 올린 글 | 팔로워 | 합계(기준) | 비고 |")
    L.append("|---|---|---|---|---|")
    for acc in accounts:
        if acc["token_missing"]:
            L.append(f"| {acc['title']} | {len(acc['posts'])} | 없음 | 없음 | 스냅샷 없음(토큰 없음 — 앱에서 확인) |")
            continue
        label = acc["posts"][0]["primary_label"] if acc["posts"] else ("조회" if acc["platform"] == "threads" else "좋아요+댓글")
        total = sum(p["primary"] or 0 for p in acc["posts"])
        delta = "" if acc["followers_prev"] is None or acc["followers"] is None else f" ({acc['followers'] - acc['followers_prev']:+d})"
        note = f"내림 {acc['removed']}" if acc["removed"] else ""
        if acc["unmatched"]:
            note += (" · " if note else "") + f"큐 밖 글 {len(acc['unmatched'])}"
        L.append(f"| {acc['title']} | {len(acc['posts'])} | {fmt(acc['followers'])}{delta} | {total:,} ({label}) | {note} |")
    L.append(f"| {ACCOUNT_TITLE['blog']} | {len(blog['items'])} | 앱에서 확인 | 앱에서 확인 | {blog['error'] or 'RSS 목록'} |")
    L.append("")

    for acc in accounts:
        L.append(f"## {acc['title']}")
        L.append("")
        if acc["token_missing"]:
            L.append(f"- 스냅샷이 없다(토큰 없음). 이번 주 큐 기준 올린 글 {len(acc['posts'])}개:")
            for p in sorted(acc["posts"], key=lambda p: p["when"]):
                L.append(f"  - {p['when']:%m/%d %H:%M} `{p['id']}` {p['title']} [{p['series']}]")
            L.append("")
            continue
        L.append(f"- 글 {len(acc['posts'])}개 · 팔로워 {fmt(acc['followers'])}"
                 + ("" if acc["followers_prev"] is None else f" (주 시작 {fmt(acc['followers_prev'])})")
                 + (f" · 프로필 조회(어제) {fmt(acc['profile_views_day'])}" if acc["profile_views_day"] is not None else "")
                 + f" · 스냅샷 {acc['snapshot_date']}")
        if acc["errors"]:
            L.append("- 수집 메모: " + " / ".join(e[:120] for e in acc["errors"]))
        top, bottom = top_bottom(acc["posts"])
        if top:
            L.append(f"- **잘된 글 TOP {len(top)}** ({top[0]['primary_label']} 기준)")
            for p in top:
                L.append(f"  - {post_line(p, acc['platform'])}")
        if bottom:
            L.append(f"- **약한 글 {len(bottom)}**")
            for p in bottom:
                L.append(f"  - {post_line(p, acc['platform'])}")
        no_metrics = [p for p in acc["posts"] if not p["has_metrics"]]
        if no_metrics:
            L.append(f"- 수치 못 받은 글 {len(no_metrics)}: " + ", ".join(f"`{p['id']}`" for p in no_metrics))
        if acc["unmatched"]:
            L.append(f"- 큐 밖에서 올라간 글 {len(acc['unmatched'])} (직접 올린 것):")
            for u in acc["unmatched"]:
                m = u.get("metrics") or {}
                L.append(f"  - {u['published_at'][:10]} {u['format']} {u.get('caption_first_line', '')} — 좋아요 {fmt(m.get('likes'))} · 댓글 {fmt(m.get('comments'))}")
        L.append("")

    L.append(f"## {ACCOUNT_TITLE['blog']}")
    L.append("")
    if blog["error"]:
        L.append(f"- {blog['error']} — {BLOG_URL}")
    elif not blog["items"]:
        L.append("- 이번 주 RSS에 새 글 없음")
    for b in blog["items"]:
        L.append(f"- {b['when']:%m/%d} [{b['category'] or '글'}] [{b['title']}]({b['link']}) [{b['series']}] — 조회수 앱에서 확인")
    L.append("")

    L.append("## 연재별")
    L.append("")
    L.append("| 연재 | 글 수 | 계정별 | 합계 | 가장 잘된 글 |")
    L.append("|---|---|---|---|---|")
    for row in series_table(accounts):
        by_acc = ", ".join(f"{k.split(' ')[-1]} {v}" for k, v in row["by_account"].items())
        sums = " / ".join(f"{ACCOUNT_TITLE[k].split(' ')[-1]} {v:,}({row['label'][k]})" for k, v in row["sum"].items()) or "없음"
        best = f"{row['best']['title']} ({row['best']['account'].split(' ')[-1]}, {row['best']['primary']:,} {row['best']['primary_label']})" if row["best"] else "없음"
        L.append(f"| {row['series']} | {row['n']} | {by_acc} | {sums} | {best} |")
    blog_series = defaultdict(int)
    for b in blog["items"]:
        blog_series[b["series"]] += 1
    if blog_series:
        L.append("")
        L.append("블로그: " + ", ".join(f"{k} {v}편" for k, v in blog_series.items()))
    L.append("")

    L.append("## 7일 테스트 보드")
    L.append("")
    if not tests:
        L.append("- 태그 달린 글 없음 (`metrics_test_tag.py`로 붙인다)")
    for g in tests:
        L.append(f"### {g['group']} — {g['variable']} ({g['account']})")
        L.append(f"- 가설: {g['hypothesis']}")
        L.append(f"- 지표: {g['kpi']} · **판정: {g['verdict']}**")
        for r in g["rows"]:
            mean = "없음" if r["mean"] is None else f"{r['mean']:.3g}"
            L.append(f"  - {r['variant']}: n={r['n']}, 평균 {mean}" + " — " + ", ".join(f"`{p['id']}`" for p in r["posts"]))
        if g["pending"]:
            L.append(f"  - 아직 수치 없음/예약 {len(g['pending'])}: " + ", ".join(g["pending"][:8]) + (" …" if len(g["pending"]) > 8 else ""))
        L.append("")
    if pairs:
        L.append("### 형식 비교 — 같은 내용 카드뉴스 vs 릴스 (이번 주)")
        for pr in pairs:
            c, r = pr["carousel"], pr["reel"]
            L.append(f"- `{pr['stem']}`: 카드뉴스 {c['primary']:,}({c['primary_label']}) vs 릴스 {r['primary']:,}({r['primary_label']})")
        L.append("")

    L.append("## 빈 곳·해야 할 일")
    L.append("")
    gaps = []
    for acc in accounts:
        if acc["token_missing"]:
            gaps.append(f"{acc['title']}: 맥에 토큰이 없어 수치 없음 — GitHub Actions 워크플로(metrics-collect.yml) 등록 후 자동 수집")
        for e in acc["errors"]:
            if "권한" in e:
                gaps.append(f"{acc['title']}: 인사이트 권한 없음 — 시스템 사용자 토큰에 instagram_manage_insights 추가")
    gaps.append("블로그: 조회수 API 없음 — 네이버 블로그 앱 통계에서 확인")
    for gap in gaps:
        L.append(f"- {gap}")
    L.append("")
    return "\n".join(L)


def build_telegram(start: datetime, end: datetime, accounts: list[dict], blog: dict, tests: list[dict], report_path: Path) -> str:
    week = f"{start:%m/%d}~{(end - timedelta(days=1)):%m/%d}"
    L = [f"📊 4계정 주간 성과 {week}"]
    for acc in accounts:
        short = acc["title"].replace("Instagram ", "IG ").replace("Threads ", "TH ")
        if acc["token_missing"]:
            L.append(f"\n{short}: 글 {len(acc['posts'])} · 수치 없음(토큰 없음, 앱에서 확인)")
            continue
        label = acc["posts"][0]["primary_label"] if acc["posts"] else "-"
        total = sum(p["primary"] or 0 for p in acc["posts"])
        delta = "" if acc["followers_prev"] is None or acc["followers"] is None else f"({acc['followers'] - acc['followers_prev']:+d})"
        L.append(f"\n{short}: 글 {len(acc['posts'])} · {label} 합계 {total:,} · 팔로워 {fmt(acc['followers'])}{delta}")
        top, bottom = top_bottom(acc["posts"])
        if top:
            L.append("  잘됨: " + " / ".join(f"{p['title'][:18]}({p['primary']:,})" for p in top))
        if bottom:
            L.append("  약함: " + " / ".join(f"{p['title'][:18]}({p['primary']:,})" for p in bottom))
    L.append(f"\n블로그: 새 글 {len(blog['items'])}편" + (" · " + " / ".join(b["title"][:18] for b in blog["items"][:3]) if blog["items"] else "") + " · 조회수는 앱에서")
    rows = series_table(accounts)
    if rows:
        L.append("\n연재별: " + " / ".join(
            f"{r['series']} {r['n']}글" + (f"(최고 {r['best']['primary']:,})" if r["best"] else "") for r in rows))
    L.append("\n🧪 테스트 보드")
    if not tests:
        L.append("  태그 글 없음")
    for g in tests[:8]:
        L.append(f"  {g['group']} [{g['variable']}]: {g['verdict']}" + (f" · 대기 {len(g['pending'])}" if g["pending"] else ""))
    gaps = [f"{a['title'].split(' ')[-1]} 토큰 없음" for a in accounts if a["token_missing"]]
    if any("권한" in e for a in accounts for e in a["errors"]):
        gaps.append("IG 인사이트 권한 필요")
    if gaps:
        L.append("\n⚠️ " + " · ".join(gaps))
    L.append(f"\n전체: {report_path}")
    text = "\n".join(L)
    if len(text) > TELEGRAM_LIMIT:
        text = text[:TELEGRAM_LIMIT - 20].rstrip() + "\n…(전체는 파일)"
    return text


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--week-ending", help="지난주 일요일 날짜 YYYY-MM-DD (기본: 오늘 기준 지난주)")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT))
    parser.add_argument("--outbox", default=str(DEFAULT_OUTBOX))
    parser.add_argument("--no-telegram", action="store_true", help="텔레그램 outbox 파일을 만들지 않음(시험 실행)")
    parser.add_argument("--print", action="store_true", help="텔레그램 요약을 화면에도 출력")
    args = parser.parse_args(argv)

    today = datetime.now(KST)
    start, end = week_bounds(args.week_ending, today)
    report_date = today.strftime("%Y-%m-%d")
    accounts = [account_section(name, start, end) for name in ACCOUNT_ORDER]
    blog = blog_section(start, end)
    tests = test_board(start, end)
    ig = next(a for a in accounts if a["name"] == "ig-pickharu")
    pairs = format_pairs(ig)

    out_dir = Path(args.out_dir).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / f"{report_date}-weekly.md"
    report_path.write_text(build_markdown(start, end, accounts, blog, tests, pairs, report_date), encoding="utf-8")
    print(f"보고서: {report_path}")

    summary = build_telegram(start, end, accounts, blog, tests, report_path)
    if args.print:
        print("----- 텔레그램 요약 -----")
        print(summary)
        print(f"----- {len(summary)}자 -----")
    if not args.no_telegram:
        outbox = Path(args.outbox).expanduser()
        outbox.mkdir(parents=True, exist_ok=True)
        tg_path = outbox / f"{report_date}-weekly.txt"
        tg_path.write_text(summary, encoding="utf-8")
        print(f"텔레그램 outbox: {tg_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
