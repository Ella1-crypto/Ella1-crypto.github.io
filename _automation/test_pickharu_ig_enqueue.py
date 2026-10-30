import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pickharu_ig_enqueue as eq  # noqa: E402
from jaetech_publish import KST, READY  # noqa: E402


def fake_convert(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(b"jpg")


class BuildTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.cards = base / "out" / "20261030-ganadi"
        self.cards.mkdir(parents=True)
        for n in (1, 2, 3):
            (self.cards / f"{n:02d}.png").write_bytes(b"png")
        (self.cards / "sheet.png").write_bytes(b"png")  # 확인용 모음 이미지는 올리지 않는다
        self.site = base / "site"
        self.site.mkdir()
        self.at = datetime(2026, 10, 31, 19, 0, tzinfo=KST)

    def tearDown(self):
        self.tmp.cleanup()

    def build(self, queue=(), **kw):
        return eq.build(self.cards, "가나디 정리 🍒\n#가나디", self.at, list(queue), self.site,
                        convert=fake_convert, story=fake_convert, **kw)

    def test_makes_vertical_story_image_from_first_card(self):
        new = self.build()[-1]
        self.assertEqual(new["story_image"], "assets/pickharu/ig/ig-20261030-ganadi/story.jpg")
        self.assertTrue((self.site / new["story_image"]).is_file())

    def test_real_story_image_is_1080x1920(self):
        from PIL import Image
        src = Path(self.tmp.name) / "card.png"
        Image.new("RGB", (1080, 1350), (240, 240, 240)).save(src)
        dst = Path(self.tmp.name) / "story.jpg"
        eq.to_story(src, dst)
        self.assertEqual(Image.open(dst).size, (1080, 1920))

    def test_converts_numbered_cards_to_jpeg_and_adds_ready_item(self):
        queue = self.build()
        new = queue[-1]
        self.assertEqual(new["id"], "ig-20261030-ganadi")
        self.assertEqual(new["status"], READY)
        self.assertEqual(new["publish_at"], "2026-10-31T19:00+09:00")
        self.assertEqual(new["images"], [f"assets/pickharu/ig/ig-20261030-ganadi/0{n}.jpg" for n in (1, 2, 3)])
        self.assertTrue((self.site / new["images"][0]).is_file())

    def test_comment_file_text_becomes_first_comment(self):
        new = self.build(comment="블로그 정리 👉 blog.naver.com/goghibli/224457905236\n출처: 포스터\n")[-1]
        self.assertEqual(new["comment"], "블로그 정리 👉 blog.naver.com/goghibli/224457905236\n출처: 포스터")

    def test_refuses_comment_without_our_link(self):
        with self.assertRaises(ValueError):
            self.build(comment="출처: 포스터")

    def test_refuses_duplicate_id(self):
        with self.assertRaises(ValueError):
            self.build(queue=[{"id": "ig-20261030-ganadi"}])

    def test_ad_post_without_tag_is_refused(self):
        with self.assertRaises(ValueError) as ctx:
            self.build(ad=True)
        self.assertIn("[광고]", str(ctx.exception))

    def test_refuses_time_in_the_past(self):
        with self.assertRaises(ValueError):
            self.build(now=datetime(2026, 11, 1, tzinfo=KST))


if __name__ == "__main__":
    unittest.main()
