"""@pick.haru.daily 프로필 링크 모음 페이지(pickharu/index.html)를 만든다.

인스타는 캡션·댓글 주소가 눌리지 않아서(2026-10-30 확인), 프로필 링크 한 곳에 글마다 바로 가는 버튼을 모은다.
데이터: _automation/pickharu-links.json  [{"id", "date", "title", "cover", "links": [{"label", "url", "ad"}]}]
사용: python pickharu_links.py add <id> <날짜> <제목> <표지 경로> <이름=주소>... [--ad 이름]  → 맨 위에 추가하고 페이지 다시 만듦
      python pickharu_links.py build
"""
from __future__ import annotations

import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "_automation" / "pickharu-links.json"
PAGE = ROOT / "pickharu" / "index.html"
AD_NOTE = "쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다."

CSS = """
:root{--bg:#F4F1EC;--card:#fff;--ink:#2B2B33;--sub:#77727A;--pink:#FF5FA2;--line:#E6E0D8}
@media (prefers-color-scheme:dark){:root{--bg:#18171A;--card:#232127;--ink:#F3F1F4;--sub:#A9A4AE;--line:#35323A}}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--ink);font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;
 padding:24px 16px 48px;max-width:520px;margin:0 auto;word-break:keep-all}
header{text-align:center;margin-bottom:20px}
header h1{font-size:22px;letter-spacing:-.02em}
header p{color:var(--sub);font-size:14px;margin-top:6px}
.post{display:flex;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px;margin-bottom:12px}
.post img{width:84px;height:105px;object-fit:cover;border-radius:10px;flex:none}
.post h2{font-size:16px;line-height:1.35}
.post time{display:block;color:var(--sub);font-size:12px;margin:4px 0 8px}
.btns{display:flex;flex-wrap:wrap;gap:6px}
.btns a{display:inline-block;background:var(--pink);color:#fff;text-decoration:none;font-size:14px;font-weight:700;
 padding:8px 12px;border-radius:999px}
.btns a:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.ad{color:var(--sub);font-size:11px;margin-top:8px;line-height:1.4}
footer{text-align:center;margin-top:24px}
footer a{color:var(--sub);font-size:13px}
"""


def load() -> list[dict]:
    return json.loads(DATA.read_text(encoding="utf-8")) if DATA.exists() else []


def render(entries: list[dict]) -> str:
    rows = []
    for e in entries:
        btns = "".join(f'<a href="{html.escape(l["url"])}" rel="noopener">{html.escape(l["label"])}</a>' for l in e["links"])
        ad = f'<p class="ad">{AD_NOTE}</p>' if any(l.get("ad") for l in e["links"]) else ""
        rows.append(f'<article class="post"><img src="../{html.escape(e["cover"])}" alt="" loading="lazy">'
                    f'<div><h2>{html.escape(e["title"])}</h2><time>{html.escape(e["date"])}</time>'
                    f'<div class="btns">{btns}</div>{ad}</div></article>')
    return (f'<!doctype html><html lang="ko"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width,initial-scale=1"><title>pick.haru 링크 모음</title>'
            f'<style>{CSS}</style></head><body><header><h1>pick.haru 링크 모음 🎀</h1>'
            f'<p>인스타 카드뉴스에 나온 글·상품을 여기서 바로 열어 보세요</p></header>{"".join(rows)}'
            f'<footer><a href="https://blog.naver.com/goghibli" rel="noopener">네이버 블로그 전체 보기</a></footer></body></html>')


def add(entries: list[dict], item_id: str, date: str, title: str, cover: str, links: list[str],
        ads: set[str]) -> list[dict]:
    parsed = []
    for pair in links:
        label, _, url = pair.partition("=")
        if not url.startswith("https://"):
            raise ValueError(f"주소는 https://로 시작해야 해요: {pair}")
        parsed.append({"label": label, "url": url, **({"ad": True} if label in ads else {})})
    entry = {"id": item_id, "date": date, "title": title, "cover": cover, "links": parsed}
    return [entry] + [e for e in entries if e["id"] != item_id]


def main() -> int:
    args = sys.argv[1:]
    entries = load()
    if args and args[0] == "add":
        ads = {args[i + 1] for i, a in enumerate(args) if a == "--ad"}
        rest = [a for i, a in enumerate(args) if a != "--ad" and (i == 0 or args[i - 1] != "--ad")]
        entries = add(entries, rest[1], rest[2], rest[3], rest[4], rest[5:], ads)
        DATA.write_text(json.dumps(entries, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    PAGE.parent.mkdir(exist_ok=True)
    PAGE.write_text(render(entries), encoding="utf-8")
    print(PAGE)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
