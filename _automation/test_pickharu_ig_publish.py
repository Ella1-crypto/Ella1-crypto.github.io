import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pickharu_ig_publish as ig  # noqa: E402
from jaetech_publish import DONE, FAILED, IN_PROGRESS, KST, READY, ThreadsError  # noqa: E402

NOW = datetime(2026, 10, 31, 19, 5, tzinfo=KST)


def live(post_id, caption, media_type="CAROUSEL_ALBUM", ago=timedelta(0)):
    """인스타 최근 글 조회 결과 한 줄(시각은 지금 기준)."""
    at = (datetime.now(timezone.utc) - ago).strftime("%Y-%m-%dT%H:%M:%S+0000")
    return {"id": post_id, "caption": caption, "media_type": media_type, "timestamp": at}


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


def make_reel(root: Path, item_id: str = "rl-20261030-kitty7") -> str:
    folder = root / "assets" / "pickharu" / "ig" / item_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "reel.mp4").write_bytes(b"mp4")
    return f"assets/pickharu/ig/{item_id}/reel.mp4"


def reel(video, **extra):
    return {"id": "rl-20261030-kitty7", "publish_at": "2026-10-31T19:00+09:00", "status": READY,
            "caption": "초코 헬로키티 굿즈 정리 🎀", "video": video, "auto": True, **extra}


def fake_http(username="pick.haru.daily", pages=True, status="FINISHED", fail_comment=False,
              publish_error="", recent=None, recent_error=""):
    """publish_error: 피드·릴스 media_publish가 이 오류를 낸다. recent: 최근 게시물 조회 결과(recent_error면 조회도 실패)."""
    calls, kinds = [], {}

    def http(method, url, params):
        calls.append((method, url, dict(params)))
        if url.endswith("/me/accounts"):
            account = {"id": "1784", "username": username}
            return {"data": [{"instagram_business_account": account}] if pages else []}
        if url.endswith("/1784") and method == "GET":
            return {"id": "1784", "username": username}
        if url.endswith("/1784/media") and method == "GET":
            if recent_error:
                raise ThreadsError(recent_error)
            return {"data": recent or []}
        if url.endswith("/1784/media"):
            kinds[f"c{len(calls)}"] = params.get("media_type")
            return {"id": f"c{len(calls)}"}
        if url.endswith("/1784/media_publish"):
            if kinds.get(params["creation_id"]) == "STORIES":
                return {"id": "story7"}
            if publish_error:
                raise ThreadsError(publish_error)
            return {"id": "post9"}
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

    def test_ad_post_needs_ad_tag_on_last_line(self):
        images = make_site(self.root)
        self.assertIn("[광고]", ig.problem_of(item(images, ad=True), self.root))
        first = item(images, ad=True, caption="[광고] 쿠팡파트너스 · 겨울 담요 3개 🍒\n본문")
        self.assertIn("끝부분", ig.problem_of(first, self.root))
        ok = item(images, ad=True, caption="겨울 담요 3개 🍒\n본문\n#담요\n\n[광고] 쿠팡파트너스\n이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.")
        self.assertEqual(ig.problem_of(ok, self.root), "")

    def test_source_comment_without_blog_passes(self):
        images = make_site(self.root)
        self.assertEqual(ig.problem_of(item(images, comment="출처: 금강일보 2026.10.12"), self.root), "")
        self.assertEqual(ig.problem_of(item(images), self.root), "")

    def test_blog_address_comment_is_rejected(self):
        images = make_site(self.root)
        self.assertIn("블로그", ig.problem_of(item(images, comment=f"정리 더 보기 {ig.BLOG}/224457905236"), self.root))

    def test_valid_reel_passes_without_images(self):
        self.assertEqual(ig.problem_of(reel(make_reel(self.root)), self.root), "")

    def test_reel_must_be_mp4_in_repo(self):
        self.assertIn("mp4", ig.problem_of(reel("assets/pickharu/ig/x/reel.mov"), self.root))
        self.assertIn("없음", ig.problem_of(reel("assets/pickharu/ig/x/reel.mp4"), self.root))

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


class RecheckTest(unittest.TestCase):
    def test_long_wait_is_cut_so_new_earlier_items_are_seen(self):
        slept = []
        ig.capped_sleep(3600, slept.append)
        ig.capped_sleep(30, slept.append)
        self.assertEqual(slept, [ig.RECHECK_SECONDS, 30])


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

    def run_once(self, items, http=None, notify=None):
        self.queue.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
        result = ig.run_once(NOW, "tok", http or fake_http(), commit=lambda m: self.commits.append(m) or True,
                             sleep=lambda s: None, path=self.queue, site_root=self.root, notify=notify)
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

    def test_reel_without_auto_is_left_for_user_to_post_with_music(self):
        http = fake_http()
        manual = {k: v for k, v in reel(make_reel(self.root), comment="출처: 기사").items() if k != "auto"}
        sent = []
        result, items = self.run_once([manual], http, notify=lambda it: sent.append(it["id"]) or "https://github.com/x/issues/1")
        self.assertEqual(items[0]["status"], ig.MANUAL)
        self.assertEqual(sent, [manual["id"]])
        self.assertIn("issues/1", items[0]["note"])
        self.assertIn("직접", result)
        self.assertFalse([c for c in http.calls if c[0] == "POST"])

    def test_reel_posts_video_to_reels_tab_only_with_comment_and_no_story(self):
        http = fake_http()
        result, items = self.run_once([reel(make_reel(self.root), comment="출처: 기사")], http)
        create = [c for c in http.calls if c[2].get("media_type") == "REELS"]
        self.assertTrue(create[0][2]["video_url"].endswith("/reel.mp4"))
        self.assertEqual(create[0][2]["share_to_feed"], "false")
        self.assertIn("post9", result)
        self.assertEqual(items[0]["comment_id"], "cm5")
        self.assertFalse([c for c in http.calls if c[2].get("media_type") == "STORIES"])

    def test_reels_have_their_own_cap_apart_from_feed(self):
        images = make_site(self.root)
        feed = [dict(item(images), id=f"d{n}", status=DONE, published_at="2026-10-31T09:00+09:00") for n in range(1, ig.DAILY_CAP + 1)]
        result, items = self.run_once(feed + [reel(make_reel(self.root))])
        self.assertEqual(items[-1]["status"], DONE)
        reels = [dict(reel(make_reel(self.root, f"rl-{n}")), id=f"rl-{n}", status=DONE,
                      published_at="2026-10-31T09:00+09:00") for n in range(1, ig.REELS_CAP + 1)]
        result, items = self.run_once(reels + [reel(make_reel(self.root, "rl-last"), id="rl-last")])
        self.assertEqual(items[-1]["status"], FAILED)
        self.assertIn("릴스", items[-1]["note"])

    def test_publish_error_but_post_is_live_counts_as_done(self):
        # 2026-11-02 10:15·11:40·12:00: media_publish가 403 "Application request limit reached"를 냈지만 인스타엔 올라감
        caption = item([])["caption"]
        http = fake_http(publish_error="HTTP 403: Application request limit reached",
                         recent=[live("old1", "다른 글"), live("live3", caption + "\n")])
        result, items = self.run_once([item(make_site(self.root), comment="출처: 투썸플레이스")], http)
        self.assertEqual(items[0]["status"], DONE)
        self.assertEqual(items[0]["post_id"], "live3")
        self.assertIn("403", items[0]["note"])
        self.assertEqual(items[0]["comment_id"], "cm5")
        self.assertEqual(items[0]["story_id"], "story7")
        self.assertIn("live3", result)

    def test_publish_error_with_no_matching_post_stays_failed(self):
        caption = item([])["caption"]
        # 같은 캡션이라도 짝 릴스(VIDEO)나 예전 글은 이번 피드가 아니다
        http = fake_http(publish_error="HTTP 403: Application request limit reached",
                         recent=[live("old1", "다른 글"), live("reel2", caption, "VIDEO"),
                                 live("old7", caption, ago=timedelta(hours=3))])
        with self.assertRaises(SystemExit):
            self.run_once([item(make_site(self.root))], http)
        items = json.loads(self.queue.read_text(encoding="utf-8"))
        self.assertEqual(items[0]["status"], FAILED)
        self.assertIn("403", items[0]["note"])

    def test_publish_error_and_failed_lookup_stays_failed(self):
        http = fake_http(publish_error="HTTP 403: Application request limit reached",
                         recent_error="HTTP 403: Application request limit reached")
        with self.assertRaises(SystemExit):
            self.run_once([reel(make_reel(self.root))], http)
        items = json.loads(self.queue.read_text(encoding="utf-8"))
        self.assertEqual(items[0]["status"], FAILED)
        self.assertIn("확인", items[0]["note"])

    def test_missing_ig_account_stops_before_marking_in_progress(self):
        with self.assertRaises(SystemExit):
            self.run_once([item(make_site(self.root))], fake_http(pages=False))
        items = json.loads(self.queue.read_text(encoding="utf-8"))
        self.assertNotEqual(items[0]["status"], IN_PROGRESS)



class RelayDelayTest(unittest.TestCase):
    def at(self, hhmm: str, status: str = READY) -> dict:
        return {"id": hhmm, "publish_at": f"2026-10-31T{hhmm}+09:00", "status": status}

    def test_returns_none_when_nothing_scheduled(self):
        self.assertIsNone(ig.relay_delay([self.at("20:00", DONE), self.at("21:00", FAILED)], NOW))

    def test_waits_until_lead_time_before_far_post(self):
        # 19:05 기준, 다음 글 다음 날 06:05(11시간 뒤) → 300분 전인 01:05까지 6시간이지만 최대 330분
        items = [{"id": "x", "publish_at": "2026-11-01T06:05+09:00", "status": READY}]
        self.assertEqual(ig.relay_delay(items, NOW), ig.RELAY_MAX.total_seconds())

    def test_uses_lead_time_for_medium_distance(self):
        items = [{"id": "x", "publish_at": "2026-11-01T02:05+09:00", "status": READY}]  # 7시간 뒤
        self.assertEqual(ig.relay_delay(items, NOW), 120 * 60)

    def test_near_or_overdue_post_uses_minimum_gap(self):
        self.assertEqual(ig.relay_delay([self.at("20:00")], NOW), ig.RELAY_MIN.total_seconds())
        self.assertEqual(ig.relay_delay([self.at("18:00")], NOW), ig.RELAY_MIN.total_seconds())

    def test_ignores_posts_past_late_limit(self):
        self.assertIsNone(ig.relay_delay([self.at("14:00")], NOW))


if __name__ == "__main__":
    unittest.main()
