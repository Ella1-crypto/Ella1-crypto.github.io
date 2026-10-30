import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pickharu_ig_publish as ig  # noqa: E402
from jaetech_publish import DONE, FAILED, IN_PROGRESS, KST, READY, ThreadsError  # noqa: E402

NOW = datetime(2026, 10, 31, 19, 5, tzinfo=KST)


def make_site(root: Path, item_id: str = "ig-20261031-ganadi", count: int = 3) -> list[str]:
    folder = root / "assets" / "pickharu" / "ig" / item_id
    folder.mkdir(parents=True)
    paths = []
    for n in range(1, count + 1):
        (folder / f"{n:02d}.jpg").write_bytes(b"jpg")
        paths.append(f"assets/pickharu/ig/{item_id}/{n:02d}.jpg")
    return paths


def item(images, **extra):
    return {"id": "ig-20261031-ganadi", "publish_at": "2026-10-31T19:00+09:00", "status": READY,
            "caption": "투썸 가나디 케이크 정리 🍒\n\n#가나디 #투썸", "images": images, **extra}


def fake_http(username="pick.haru.daily", pages=True, status="FINISHED", fail_comment=False):
    calls, kinds = [], {}

    def http(method, url, params):
        calls.append((method, url, dict(params)))
        if url.endswith("/me/accounts"):
            account = {"id": "1784", "username": username}
            return {"data": [{"instagram_business_account": account}] if pages else []}
        if url.endswith("/1784") and method == "GET":
            return {"id": "1784", "username": username}
        if url.endswith("/1784/media"):
            kinds[f"c{len(calls)}"] = params.get("media_type")
            return {"id": f"c{len(calls)}"}
        if url.endswith("/1784/media_publish"):
            return {"id": "story7" if kinds.get(params["creation_id"]) == "STORIES" else "post9"}
        if url.endswith("/comments"):
            if fail_comment:
                raise ThreadsError("HTTP 400: comment")
            return {"id": "cm5"}
        if method == "GET":
            return {"status_code": status}
        return {}
    http.calls = calls
    return http


class ProblemTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_valid_carousel_passes(self):
        self.assertEqual(ig.problem_of(item(make_site(self.root)), self.root), "")

    def test_png_is_rejected_because_instagram_takes_jpeg_only(self):
        self.assertIn("jpg", ig.problem_of(item(["assets/pickharu/ig/x/01.png"]), self.root))

    def test_missing_file_is_reported(self):
        self.assertIn("없음", ig.problem_of(item(["assets/pickharu/ig/x/01.jpg"]), self.root))

    def test_more_than_ten_images_is_rejected(self):
        self.assertIn("10장", ig.problem_of(item(make_site(self.root, count=11)), self.root))

    def test_ad_post_needs_ad_tag_on_first_line(self):
        images = make_site(self.root)
        self.assertIn("[광고]", ig.problem_of(item(images, ad=True), self.root))
        ok = item(images, ad=True, caption="[광고] 쿠팡파트너스 · 겨울 담요 3개 🍒\n본문")
        self.assertEqual(ig.problem_of(ok, self.root), "")

    def test_source_comment_without_blog_passes(self):
        images = make_site(self.root)
        self.assertEqual(ig.problem_of(item(images, comment="출처: 금강일보 2026.10.12"), self.root), "")
        self.assertEqual(ig.problem_of(item(images), self.root), "")

    def test_blog_address_comment_is_rejected(self):
        images = make_site(self.root)
        self.assertIn("블로그", ig.problem_of(item(images, comment=f"정리 더 보기 {ig.BLOG}/224457905236"), self.root))

    def test_too_many_hashtags_is_rejected(self):
        caption = "정리 blog.naver.com/goghibli " + " ".join(f"#태그{n}" for n in range(31))
        self.assertIn("해시태그", ig.problem_of(item(make_site(self.root), caption=caption), self.root))


class PublishTest(unittest.TestCase):
    def test_carousel_creates_children_then_parent_and_publishes(self):
        http = fake_http()
        post = ig.publish(item(["a/01.jpg", "a/02.jpg"]), "1784", "tok", http, sleep=lambda s: None)
        self.assertEqual(post, "post9")
        media = [c for c in http.calls if c[1].endswith("/1784/media")]
        self.assertEqual([c[2].get("is_carousel_item") for c in media], ["true", "true", None])
        self.assertEqual(media[0][2]["image_url"], ig.SITE_URL + "a/01.jpg")
        self.assertEqual(media[-1][2]["media_type"], "CAROUSEL")
        self.assertIn("가나디", media[-1][2]["caption"])

    def test_single_image_posts_without_carousel(self):
        http = fake_http()
        ig.publish(item(["a/01.jpg"]), "1784", "tok", http, sleep=lambda s: None)
        media = [c for c in http.calls if c[1].endswith("/1784/media")]
        self.assertEqual(len(media), 1)
        self.assertNotIn("media_type", media[0][2])

    def test_container_error_stops_publish(self):
        http = fake_http(status="ERROR")
        with self.assertRaises(ThreadsError):
            ig.publish(item(["a/01.jpg"]), "1784", "tok", http, sleep=lambda s: None)
        self.assertFalse([c for c in http.calls if c[1].endswith("media_publish")])


class AccountTest(unittest.TestCase):
    def test_finds_account_through_page(self):
        self.assertEqual(ig.find_ig_user("tok", fake_http()), "1784")

    def test_configured_id_is_checked_by_username(self):
        self.assertEqual(ig.find_ig_user("tok", fake_http(), configured="1784"), "1784")
        with self.assertRaises(ThreadsError):
            ig.find_ig_user("tok", fake_http(username="gonew.nya"), configured="1784")

    def test_explains_page_link_when_nothing_found(self):
        with self.assertRaises(ThreadsError) as ctx:
            ig.find_ig_user("tok", fake_http(pages=False))
        self.assertIn("페이지", str(ctx.exception))


class RunOnceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "_automation").mkdir()
        self.queue = self.root / "_automation" / "q.json"
        self.commits = []

    def tearDown(self):
        self.tmp.cleanup()

    def run_once(self, items, http=None):
        self.queue.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
        result = ig.run_once(NOW, "tok", http or fake_http(), commit=lambda m: self.commits.append(m) or True,
                             sleep=lambda s: None, path=self.queue, site_root=self.root)
        return result, json.loads(self.queue.read_text(encoding="utf-8"))

    def test_posts_due_item_and_marks_done(self):
        result, items = self.run_once([item(make_site(self.root))])
        self.assertIn("post9", result)
        self.assertEqual(items[0]["status"], DONE)
        self.assertEqual(items[0]["post_id"], "post9")
        self.assertTrue(any("올리는 중" in m for m in self.commits))

    def test_no_comment_when_item_has_none(self):
        http = fake_http()
        _, items = self.run_once([item(make_site(self.root))], http)
        self.assertFalse([c for c in http.calls if c[1].endswith("/comments")])
        self.assertNotIn("comment_id", items[0])

    def test_source_comment_and_story_follow_the_post(self):
        http = fake_http()
        _, items = self.run_once([item(make_site(self.root), comment="출처: 투썸플레이스")], http)
        comment = [c for c in http.calls if c[1].endswith("/post9/comments")]
        self.assertEqual(comment[0][2]["message"], "출처: 투썸플레이스")
        self.assertEqual(items[0]["comment_id"], "cm5")
        story = [c for c in http.calls if c[2].get("media_type") == "STORIES"]
        self.assertTrue(story[0][2]["image_url"].endswith("/01.jpg"))
        self.assertEqual(items[0]["story_id"], "story7")

    def test_comment_failure_keeps_post_done(self):
        result, items = self.run_once([item(make_site(self.root), comment="출처: 기사")], fake_http(fail_comment=True))
        self.assertEqual(items[0]["status"], DONE)
        self.assertIn("comment_error", items[0])
        self.assertEqual(items[0]["story_id"], "story7")

    def test_story_uses_vertical_story_image_when_given(self):
        http = fake_http()
        images = make_site(self.root)
        (self.root / "assets/pickharu/ig/ig-20261031-ganadi/story.jpg").write_bytes(b"jpg")
        self.run_once([item(images, story_image="assets/pickharu/ig/ig-20261031-ganadi/story.jpg")], http)
        story = [c for c in http.calls if c[2].get("media_type") == "STORIES"]
        self.assertTrue(story[0][2]["image_url"].endswith("/story.jpg"))

    def test_story_only_item_posts_just_the_story_and_skips_cap(self):
        http = fake_http()
        images = make_site(self.root)
        (self.root / "assets/pickharu/ig/ig-20261031-ganadi/story.jpg").write_bytes(b"jpg")
        done = [dict(item(images), id=f"d{n}", status=DONE, published_at="2026-10-31T09:00+09:00") for n in range(1, ig.DAILY_CAP + 1)]
        story = {"id": "st-1", "publish_at": "2026-10-31T19:00+09:00", "status": READY, "story_only": True,
                 "story_image": "assets/pickharu/ig/ig-20261031-ganadi/story.jpg"}
        result, items = self.run_once(done + [story], http)
        self.assertIn("스토리 올림", result)
        self.assertEqual(items[-1]["status"], DONE)
        self.assertEqual(items[-1]["story_id"], "story7")
        self.assertFalse([c for c in http.calls if c[2].get("media_type") == "CAROUSEL"])
        self.assertFalse([c for c in http.calls if c[1].endswith("/comments")])

    def test_story_can_be_turned_off(self):
        http = fake_http()
        _, items = self.run_once([item(make_site(self.root), story=False)], http)
        self.assertNotIn("story_id", items[0])
        self.assertFalse([c for c in http.calls if c[2].get("media_type") == "STORIES"])

    def test_waits_while_pages_has_not_deployed_images(self):
        http = fake_http()
        self.queue.write_text(json.dumps([item(make_site(self.root))], ensure_ascii=False), encoding="utf-8")
        result = ig.run_once(NOW, "tok", http, commit=lambda m: self.commits.append(m) or True,
                             sleep=lambda s: None, path=self.queue, site_root=self.root, ready=lambda rel: False)
        items = json.loads(self.queue.read_text(encoding="utf-8"))
        self.assertIn("반영 대기", result)
        self.assertEqual(items[0]["status"], READY)
        self.assertEqual(http.calls, [])

    def test_bad_item_is_failed_without_calling_api(self):
        http = fake_http()
        result, items = self.run_once([item(["assets/pickharu/ig/x/01.png"])], http)
        self.assertEqual(items[0]["status"], FAILED)
        self.assertEqual(http.calls, [])

    def test_daily_cap_blocks_post_over_cap(self):
        images = make_site(self.root)
        done = [dict(item(images), id=f"d{n}", status=DONE, published_at="2026-10-31T09:00+09:00") for n in range(1, ig.DAILY_CAP + 1)]
        result, items = self.run_once(done + [item(images)])
        self.assertEqual(items[-1]["status"], FAILED)
        self.assertIn("상한", items[-1]["note"])

    def test_missing_ig_account_stops_before_marking_in_progress(self):
        with self.assertRaises(SystemExit):
            self.run_once([item(make_site(self.root))], fake_http(pages=False))
        items = json.loads(self.queue.read_text(encoding="utf-8"))
        self.assertNotEqual(items[0]["status"], IN_PROGRESS)


if __name__ == "__main__":
    unittest.main()
