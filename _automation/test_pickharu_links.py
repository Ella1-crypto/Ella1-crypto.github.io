import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pickharu_links as pl  # noqa: E402


class LinksTest(unittest.TestCase):
    def test_new_entry_goes_on_top_and_replaces_same_id(self):
        old = [{"id": "a", "date": "10/29", "title": "옛 글", "cover": "x.jpg", "links": []}]
        out = pl.add(old, "b", "10/30", "새 글", "y.jpg", ["블로그 글=https://blog.naver.com/goghibli/1"], set())
        self.assertEqual([e["id"] for e in out], ["b", "a"])
        again = pl.add(out, "a", "10/31", "고친 글", "x.jpg", [], set())
        self.assertEqual([e["id"] for e in again], ["a", "b"])

    def test_ad_link_shows_partners_note(self):
        out = pl.add([], "t", "10/30", "텀블러", "t.jpg", ["쿠팡=https://link.coupang.com/a/x"], {"쿠팡"})
        page = pl.render(out)
        self.assertIn('href="https://link.coupang.com/a/x"', page)
        self.assertIn("쿠팡 파트너스", page)

    def test_plain_entry_has_no_ad_note_and_escapes_title(self):
        page = pl.render(pl.add([], "k", "10/30", "키티 <굿즈>", "k.jpg", ["블로그=https://blog.naver.com/goghibli/2"], set()))
        self.assertNotIn("쿠팡 파트너스", page)
        self.assertIn("키티 &lt;굿즈&gt;", page)

    def test_rejects_non_https_link(self):
        with self.assertRaises(ValueError):
            pl.add([], "k", "10/30", "t", "k.jpg", ["블로그=javascript:alert(1)"], set())


if __name__ == "__main__":
    unittest.main()
