"""사용자가 고른 카드뉴스를 인스타 예약 목록(pickharu-ig-queue.json)에 넣고 푸시한다.

사용:
  python pickharu_ig_enqueue.py <카드 폴더> --caption <캡션.txt> --at 2026-10-31T19:00 [--ad] [--dry-run]
- 카드 폴더: pickharu/insta/out/<날짜-주제> (make_cards.py 결과, 01.png 02.png …)
- PNG를 JPEG로 바꿔 assets/pickharu/ig/ig-<날짜-주제>/에 두고(인스타 API는 JPEG만 받음) 큐와 함께 커밋·푸시한다.
- 시각은 KST. 사용자가 예약하라고 한 글만 넣는다(초안을 보여 주기 전엔 넣지 않음).
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Callable

from jaetech_publish import KST, READY, load_queue, save_queue
from pickharu_ig_publish import QUEUE_PATH, SITE_ROOT, problem_of

CARD_RE = re.compile(r"\d{2}\.png")  # sheet.png 같은 확인용 이미지는 빼고 번호 붙은 카드만


def to_jpeg(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-q:v", "2", str(dst)],
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"JPEG 변환 실패: {src.name} — {result.stderr[-200:]}")


def build(cards: Path, caption: str, at: datetime, queue: list[dict], site_root: Path = SITE_ROOT,
          ad: bool = False, now: datetime | None = None,
          convert: Callable[[Path, Path], None] = to_jpeg) -> list[dict]:
    item_id = f"ig-{cards.name}"
    if any(it.get("id") == item_id for it in queue):
        raise ValueError(f"{item_id}: 이미 예약 목록에 있음")
    if at <= (now or datetime.now(KST)):
        raise ValueError(f"예약 시각이 이미 지났음: {at.isoformat(timespec='minutes')}")
    pngs = sorted(p for p in cards.iterdir() if CARD_RE.fullmatch(p.name))
    if not pngs:
        raise ValueError(f"카드 이미지(01.png …)가 없음: {cards}")
    images = []
    for png in pngs:
        rel = f"assets/pickharu/ig/{item_id}/{png.stem}.jpg"
        convert(png, site_root / rel)
        images.append(rel)
    item = {"id": item_id, "publish_at": at.isoformat(timespec="minutes"), "caption": caption.strip(),
            "images": images, "status": READY}
    if ad:
        item["ad"] = True
    problem = problem_of(item, site_root)
    if problem:
        raise ValueError(f"넣지 않았습니다 — {problem}")
    return queue + [item]


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=SITE_ROOT, capture_output=True, text=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("cards")
    parser.add_argument("--caption", required=True)
    parser.add_argument("--at", required=True)
    parser.add_argument("--ad", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if git("pull", "--rebase").returncode != 0:
        print("최신 저장소를 받지 못했습니다(git pull 실패).", file=sys.stderr)
        return 1
    caption = Path(args.caption).read_text(encoding="utf-8")
    at = datetime.fromisoformat(args.at).replace(tzinfo=KST)
    try:
        queue = build(Path(args.cards), caption, at, load_queue(QUEUE_PATH) if QUEUE_PATH.exists() else [],
                      ad=args.ad)
    except (ValueError, RuntimeError) as error:
        print(error, file=sys.stderr)
        return 1
    new = queue[-1]
    print(f"{new['publish_at']}  {new['id']}  사진 {len(new['images'])}장  {new['caption'].splitlines()[0]}")
    if args.dry_run:
        print("(dry-run: 저장하지 않음 — 변환한 사진은 assets에 남음)")
        return 0
    save_queue(queue, QUEUE_PATH)
    git("add", "--", str(QUEUE_PATH), *new["images"])
    if git("commit", "-m", f"chore: pick.haru 인스타 예약 ({new['id']})").returncode != 0 or (
            git("push").returncode != 0 and not (git("pull", "--rebase").returncode == 0
                                                 and git("push").returncode == 0)):
        print("커밋·푸시에 실패했습니다. 예약 목록 파일을 확인하세요.", file=sys.stderr)
        return 1
    print("예약 완료 — GitHub가 시각이 되면 인스타에 올립니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
