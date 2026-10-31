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
import shutil
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


STORY_W, STORY_H = 1080, 1920
STORY_CARD_W = 940  # 위아래 글자 가림 영역(약 250px)을 피해 가운데에 카드를 놓는다


def to_story(first_card: Path, dst: Path) -> None:
    """첫 장을 9:16 스토리 판으로: 카드 가장자리 색 바탕 + 가운데 카드(그림자)."""
    from PIL import Image, ImageFilter  # 저장소 CI엔 없어도 되게 여기서만 씀

    card = Image.open(first_card).convert("RGB")
    bg_color = card.getpixel((6, card.height // 2))
    canvas = Image.new("RGB", (STORY_W, STORY_H), bg_color)
    w = STORY_CARD_W
    h = round(card.height * w / card.width)
    card = card.resize((w, h), Image.LANCZOS)
    x, y = (STORY_W - w) // 2, (STORY_H - h) // 2
    shadow = Image.new("L", (STORY_W, STORY_H), 0)
    shadow.paste(90, (x + 10, y + 18, x + w + 10, y + h + 18))
    canvas.paste((0, 0, 0), mask=shadow.filter(ImageFilter.GaussianBlur(22)))
    canvas.paste(card, (x, y))
    dst.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dst, "JPEG", quality=92)


def build(cards: Path, caption: str, at: datetime, queue: list[dict], site_root: Path = SITE_ROOT,
          ad: bool = False, now: datetime | None = None,
          convert: Callable[[Path, Path], None] = to_jpeg, comment: str = "",
          story: Callable[[Path, Path], None] = to_story) -> list[dict]:
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
    story_rel = f"assets/pickharu/ig/{item_id}/story.jpg"
    story(pngs[0], site_root / story_rel)
    item["story_image"] = story_rel
    if comment.strip():  # 없으면 블로그 홈 주소 댓글
        item["comment"] = comment.strip()
    problem = problem_of(item, site_root)
    if problem:
        raise ValueError(f"넣지 않았습니다 — {problem}")
    return queue + [item]


def build_reel(video: Path, item_id: str, caption: str, at: datetime, queue: list[dict],
               site_root: Path = SITE_ROOT, comment: str = "", now: datetime | None = None) -> list[dict]:
    """릴스 영상(make_reels.py 결과)을 assets/pickharu/ig/<id>/reel.mp4로 두고 릴스 탭 전용 항목을 더한다."""
    if any(it.get("id") == item_id for it in queue):
        raise ValueError(f"{item_id}: 이미 예약 목록에 있음")
    if at <= (now or datetime.now(KST)):
        raise ValueError(f"예약 시각이 이미 지났음: {at.isoformat(timespec='minutes')}")
    rel = f"assets/pickharu/ig/{item_id}/reel.mp4"
    (site_root / rel).parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(video, site_root / rel)
    item = {"id": item_id, "publish_at": at.isoformat(timespec="minutes"), "caption": caption.strip(),
            "video": rel, "share_to_feed": False, "status": READY}
    if comment.strip():
        item["comment"] = comment.strip()
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
    parser.add_argument("--comment", help="첫 댓글 텍스트 파일(블로그 글·스레드 글 링크 + 출처)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if git("pull", "--rebase").returncode != 0:
        print("최신 저장소를 받지 못했습니다(git pull 실패).", file=sys.stderr)
        return 1
    caption = Path(args.caption).read_text(encoding="utf-8")
    at = datetime.fromisoformat(args.at).replace(tzinfo=KST)
    try:
        queue = build(Path(args.cards), caption, at, load_queue(QUEUE_PATH) if QUEUE_PATH.exists() else [],
                      ad=args.ad, comment=Path(args.comment).read_text(encoding="utf-8") if args.comment else "")
    except (ValueError, RuntimeError) as error:
        print(error, file=sys.stderr)
        return 1
    new = queue[-1]
    print(f"{new['publish_at']}  {new['id']}  사진 {len(new['images'])}장  {new['caption'].splitlines()[0]}")
    if args.dry_run:
        print("(dry-run: 저장하지 않음 — 변환한 사진은 assets에 남음)")
        return 0
    save_queue(queue, QUEUE_PATH)
    git("add", "--", str(QUEUE_PATH), *new["images"], new["story_image"])
    if git("commit", "-m", f"chore: pick.haru 인스타 예약 ({new['id']})").returncode != 0 or (
            git("push").returncode != 0 and not (git("pull", "--rebase").returncode == 0
                                                 and git("push").returncode == 0)):
        print("커밋·푸시에 실패했습니다. 예약 목록 파일을 확인하세요.", file=sys.stderr)
        return 1
    print("예약 완료 — GitHub가 시각이 되면 인스타에 올립니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
