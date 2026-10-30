import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pickharu_publish as pp  # noqa: E402
from test_refresh_token import FakeGitHub  # noqa: E402

NOW = datetime(2026, 10, 28, 9, 2, tzinfo=pp.KST)
LINK = "https://link.coupang.com/a/abc123"
TEXT = "출근 가방 정리 이걸로 끝냈어\n파우치 몇 개 들고 다녀?\n[광고] 쿠팡파트너스"
REPLY = f"제품 보러 가기 👉 {LINK}\n\n{pp.DISCLOSURE}"


def item(i, at="2026-10-28T09:00+09:00", text=TEXT, reply=REPLY, status="예약"):
    return {"id": i, "publish_at": at, "text": text, "reply": reply, "status": status}


KAKAO_LINK = "https://gift-link.kakao.com/c/LtojEzBd"
KAKAO_TEXT = "생일 선물 고민될 때 이거 어때?\n받는 사람이 고를 수 있는 구성이야\n[광고] 카카오 선물하기"
KAKAO_REPLY = f"선물하러 가기 👉 {KAKAO_LINK}\n\n{pp.KAKAO_DISCLOSURE}"


def kakao(i, at="2026-10-28T09:00+09:00", status="예약", **kw):
    return {**item(i, at, KAKAO_TEXT, KAKAO_REPLY, status), "kind": "카카오", **kw}


class KakaoRuleTest(unittest.TestCase):
    def test_valid_kakao_passes(self):
        self.assertEqual(pp.problem_of(kakao("k")), "")

    def test_kakao_needs_its_own_tag_disclosure_and_link(self):
        self.assertIn("광고 표시", pp.problem_of(kakao("k", text=TEXT)))
        self.assertIn("고지", pp.problem_of(kakao("k", reply=f"{KAKAO_LINK}\n{pp.DISCLOSURE}")))
        self.assertIn("링크", pp.problem_of(kakao("k", reply=f"{LINK}\n{pp.KAKAO_DISCLOSURE}")))
        self.assertIn("링크", pp.problem_of(kakao("k", reply=f"https://gift.kakao.com/x\n{pp.KAKAO_DISCLOSURE}")))

    def test_naver_rules(self):
        naver = {**item("n", text="퇴근길 선물 고민이면 이거\n[광고] 네이버 브랜드 커넥트",
                        reply=f"보러 가기 👉 https://naver.me/FNtaeTiN\n\n{pp.NAVER_DISCLOSURE}"), "kind": "네이버"}
        self.assertEqual(pp.problem_of(naver), "")
        self.assertIn("광고 표시", pp.problem_of({**naver, "text": KAKAO_TEXT}))
        self.assertIn("링크", pp.problem_of({**naver, "reply": f"{KAKAO_LINK}\n{pp.NAVER_DISCLOSURE}"}))

    def test_unknown_kind_rejected(self):
        self.assertIn("종류", pp.problem_of({**item("a"), "kind": "번개장터"}))


class FakeHttp:
    def __init__(self, username="pick.haru__1", fail_reply=False, fail_body=False):
        self.calls, self.username = [], username
        self.fail_reply, self.fail_body = fail_reply, fail_body
        self.containers = 0

    def __call__(self, method, url, params):
        self.calls.append((url.rsplit("/", 1)[-1], dict(params)))
        if url.endswith("/threads"):
            self.containers += 1
            is_reply = "reply_to_id" in params
            if (is_reply and self.fail_reply) or (not is_reply and self.fail_body):
                raise pp.ThreadsError("HTTP 400: bad")
            return {"id": f"c{self.containers}"}
        if url.endswith("/threads_publish"):
            return {"id": "p" + params["creation_id"][1:]}
        if "refresh_access_token" in url:
            return {"access_token": "NEW", "expires_in": 5184000}
        return {"username": self.username, "id": "u9"}


class ProblemTest(unittest.TestCase):
    def test_valid_item_passes(self):
        self.assertEqual(pp.problem_of(item("a")), "")

    def test_rejects_link_in_body(self):
        self.assertIn("주소", pp.problem_of(item("a", text=f"이거 좋아 {LINK}\n[광고] 쿠팡파트너스")))

    def test_requires_ad_tag_on_last_line(self):
        self.assertIn("광고 표시", pp.problem_of(item("a", text="[광고] 출근 가방 정리\n파우치 몇 개 들고 다녀?")))

    def test_requires_disclosure_in_reply(self):
        self.assertIn("고지", pp.problem_of(item("a", reply=f"보러 가기 {LINK}")))

    def test_requires_exactly_one_coupang_link(self):
        self.assertIn("링크", pp.problem_of(item("a", reply=f"https://evil.example/x\n{pp.DISCLOSURE}")))
        self.assertIn("링크", pp.problem_of(item("a", reply=f"{LINK} {LINK}2\n{pp.DISCLOSURE}")))

    def test_rejects_coupang_link_hidden_in_other_url(self):
        reply = f"https://evil.example/?r={LINK}\n{pp.DISCLOSURE}"
        self.assertIn("링크", pp.problem_of(item("a", reply=reply)))

    def test_rejects_calling_reader_neo(self):
        for line in ("너는 팥붕파야 슈붕파야?", "넌 어디부터 무너져?", "너네 회사도 그래?"):
            self.assertIn("스치니들", pp.problem_of(item("a", text=f"{line}\n[광고] 쿠팡파트너스")))
        ok = "스치니들은 팥붕파야? 너무 귀엽지\n[광고] 쿠팡파트너스"  # '너무'는 호칭이 아님
        self.assertEqual(pp.problem_of(item("a", text=ok)), "")

    def test_rejects_bare_domain_in_body(self):
        self.assertIn("주소", pp.problem_of(item("a", text="여기서 봐 link.coupang.com/a/x\n[광고] 쿠팡파트너스")))


class VideoTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)
        (self.root / "assets" / "pickharu").mkdir(parents=True)
        (self.root / "assets" / "pickharu" / "v1.mp4").write_bytes(b"0" * 10)

    def tearDown(self):
        self.dir.cleanup()

    def test_video_rules(self):
        ok = {**item("a", text="이거 봐\n[광고] 쿠팡파트너스"), "video": "assets/pickharu/v1.mp4"}
        self.assertEqual(pp.video_problem(ok, self.root), "")
        self.assertIn("없음", pp.video_problem({**ok, "video": "assets/pickharu/none.mp4"}, self.root))
        self.assertIn("경로", pp.video_problem({**ok, "video": "../secret.mp4"}, self.root))

    def test_publishes_video_after_processing_finishes(self):
        calls, states = [], iter(["IN_PROGRESS", "FINISHED"])

        def http(method, url, params):
            calls.append((method, url.rsplit("/", 1)[-1], dict(params)))
            if url.endswith("/threads"):
                return {"id": "c1"}
            if url.endswith("/threads_publish"):
                return {"id": "p1"}
            return {"status": next(states)}
        post = pp.publish("[광고] AI", "tok", http, lambda s: None, video="assets/pickharu/v1.mp4")
        self.assertEqual(post, "p1")
        self.assertEqual(calls[0][2]["media_type"], "VIDEO")
        self.assertEqual(calls[0][2]["video_url"], "https://ella1-crypto.github.io/assets/pickharu/v1.mp4")
        self.assertEqual([c[1] for c in calls], ["threads", "c1", "c1", "threads_publish"])

    def test_image_rules(self):
        (self.root / "assets" / "pickharu" / "a.jpg").write_bytes(b"0")
        ok = {"kind": "일반", "text": "곰돌이 귀엽지", "images": ["assets/pickharu/a.jpg"]}
        self.assertEqual(pp.images_problem(ok, self.root), "")
        self.assertIn("없음", pp.images_problem({**ok, "images": ["assets/pickharu/none.jpg"]}, self.root))
        self.assertIn("경로", pp.images_problem({**ok, "images": ["../secret.jpg"]}, self.root))
        self.assertIn("함께", pp.images_problem({**ok, "video": "assets/pickharu/v1.mp4"}, self.root))
        self.assertIn("최대", pp.images_problem({**ok, "images": ["assets/pickharu/a.jpg"] * 21}, self.root))

    def test_publishes_single_image(self):
        calls = []

        def http(method, url, params):
            calls.append(params)
            return {"id": "c1"} if url.endswith("/threads") else {"status": "FINISHED", "id": "p1"}
        pp.publish("곰", "tok", http, lambda s: None, images=["assets/pickharu/a.jpg"])
        self.assertEqual(calls[0]["media_type"], "IMAGE")
        self.assertEqual(calls[0]["image_url"], "https://ella1-crypto.github.io/assets/pickharu/a.jpg")

    def test_gif_rules(self):
        ok = {**item("g1"), "gif": "E5wQYTyFuuJYtPW8wC"}
        self.assertEqual(pp.problem_of(ok), "")
        self.assertEqual(pp.problem_of({"kind": "일반", "text": "꽥", "gif": "E5wQYTyFuuJYtPW8wC"}), "")
        self.assertIn("GIPHY", pp.problem_of({**ok, "gif": "https://giphy.com/x"}))
        self.assertIn("영상·사진", pp.gif_problem({**ok, "images": ["assets/pickharu/a.jpg"]}))

    def test_publishes_text_with_gif_attachment(self):
        calls = []

        def http(method, url, params):
            calls.append(params)
            return {"id": "c1"}
        pp.publish("꽥", "tok", http, lambda s: None, gif="E5wQYTyFuuJYtPW8wC")
        self.assertEqual(calls[0]["media_type"], "TEXT")
        self.assertEqual(json.loads(calls[0]["gif_attachment"]), {"gif_id": "E5wQYTyFuuJYtPW8wC", "provider": "GIPHY"})
        self.assertNotIn("gif_attachment", calls[1])

    def test_publishes_carousel_with_children(self):
        calls, n = [], [0]

        def http(method, url, params):
            calls.append(params)
            if url.endswith("/threads"):
                n[0] += 1
                return {"id": f"c{n[0]}"}
            return {"status": "FINISHED", "id": "p9"}
        post = pp.publish("곰", "tok", http, lambda s: None, images=["assets/pickharu/a.jpg", "assets/pickharu/b.png"])
        self.assertEqual(post, "p9")
        self.assertTrue(all(c.get("is_carousel_item") == "true" for c in calls[:2]))
        self.assertEqual(calls[2]["media_type"], "CAROUSEL")
        self.assertEqual(calls[2]["children"], "c1,c2")
        self.assertEqual(calls[2]["text"], "곰")

    def test_video_processing_error_raises(self):
        def http(method, url, params):
            return {"id": "c1"} if url.endswith("/threads") else {"status": "ERROR", "error_message": "bad"}
        with self.assertRaises(pp.ThreadsError):
            pp.publish("[광고] AI", "tok", http, lambda s: None, video="assets/pickharu/v1.mp4")


class RunOnceTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "q.json"
        self.commits = []

    def tearDown(self):
        self.dir.cleanup()

    def write(self, items):
        self.path.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")

    def run_once(self, http, commit_ok=True, now=NOW):
        def commit(msg):
            self.commits.append((msg, json.loads(self.path.read_text(encoding="utf-8"))))
            return commit_ok
        return pp.run_once(now, "tok", http, commit, sleep=lambda s: None, path=self.path)

    def saved(self):
        return {it["id"]: it for it in pp.load_queue(self.path)}

    def test_posts_body_then_link_reply_to_that_post(self):
        self.write([item("a")])
        http = FakeHttp()
        result = self.run_once(http)
        self.assertIn("p1", result)
        self.assertEqual(self.commits[0][1][0]["status"], "올리는 중")
        replies = [p for name, p in http.calls if name == "threads" and "reply_to_id" in p]
        self.assertEqual(replies[0]["reply_to_id"], "p1")
        self.assertIn(LINK, replies[0]["text"])
        self.assertEqual(self.saved()["a"]["status"], "올림")
        self.assertEqual(self.saved()["a"]["reply_id"], "p2")

    def test_general_post_has_no_reply_and_skips_cap(self):
        done = [item(f"d{i}", at=f"2026-10-28T0{i}:00+09:00", status="올림") for i in range(1, 6)]
        general = {"id": "g", "kind": "일반", "publish_at": "2026-10-28T09:00+09:00",
                   "text": "다들 주방 정리 뭐부터 해?", "status": "예약"}
        self.write(done + [general])
        http = FakeHttp()
        self.assertIn("p1", self.run_once(http))
        self.assertFalse([p for n, p in http.calls if "reply_to_id" in p])
        self.assertEqual(self.saved()["g"]["status"], "올림")

    def test_kakao_post_has_own_cap_separate_from_coupang(self):
        done = [item(f"d{i}", at=f"2026-10-28T0{i}:00+09:00", status="올림") for i in range(1, 6)]
        self.write(done + [kakao("k")])
        http = FakeHttp()
        self.assertIn("p1", self.run_once(http))
        self.assertIn(KAKAO_LINK, [p for n, p in http.calls if "reply_to_id" in p][0]["text"])
        self.write([kakao(f"k{i}", at=f"2026-10-28T0{i}:00+09:00", status="올림") for i in (1, 2, 3)] + [kakao("k")])
        self.assertIn("하루 상한", self.run_once(FakeHttp()))

    def test_coupang_cap_is_two(self):
        # 2026-10-30 운영안: 쿠팡 하루 1~2개
        self.write([item("d1", at="2026-10-28T01:00+09:00", status="올림"), item("a")])
        self.assertIn("p1", self.run_once(FakeHttp()))
        self.write([item(f"d{i}", at=f"2026-10-28T0{i}:00+09:00", status="올림") for i in (1, 2)] + [item("a")])
        self.assertIn("하루 상한", self.run_once(FakeHttp()))

    def test_general_post_cap_is_two(self):
        def general(gid, at="2026-10-28T09:00+09:00", status="예약"):
            return {"id": gid, "kind": "일반", "publish_at": at, "text": "다들 점심 뭐 먹어?", "status": status}
        self.write([general(f"g{i}", at=f"2026-10-28T0{i}:00+09:00", status="올림") for i in (1, 2)] + [general("g")])
        self.assertIn("하루 상한", self.run_once(FakeHttp()))

    def test_general_post_still_blocks_links(self):
        self.assertIn("주소", pp.problem_of({"kind": "일반", "text": "여기 봐 link.coupang.com/a/x"}))
        self.assertIn("댓글", pp.problem_of({"kind": "일반", "text": "안녕", "reply": "x"}))

    def test_reply_failure_keeps_body_published(self):
        self.write([item("a")])
        result = self.run_once(FakeHttp(fail_reply=True))
        self.assertIn("댓글 실패", result)
        self.assertEqual(self.saved()["a"]["status"], "올림")
        self.assertIn("reply_error", self.saved()["a"])

    def test_body_failure_marks_failed(self):
        self.write([item("a")])
        with self.assertRaises(SystemExit):
            self.run_once(FakeHttp(fail_body=True))
        self.assertEqual(self.saved()["a"]["status"], "실패")

    def test_wrong_account_posts_nothing(self):
        self.write([item("a")])
        http = FakeHttp(username="heeya.dailyfit")
        with self.assertRaises(pp.ThreadsError):
            self.run_once(http)
        self.assertFalse([c for c in http.calls if c[0].startswith("threads")])
        self.assertEqual(self.saved()["a"]["status"], "예약")

    def test_does_not_post_when_in_progress_mark_cannot_be_pushed(self):
        self.write([item("a")])
        http = FakeHttp()
        with self.assertRaises(SystemExit):
            self.run_once(http, commit_ok=False)
        self.assertFalse([c for c in http.calls if c[0].startswith("threads")])

    def test_reply_timeout_still_records_post(self):
        self.write([item("a")])
        http = FakeHttp()
        original = http.__call__

        def timeout_on_reply(method, url, params):
            if "reply_to_id" in params:
                raise TimeoutError("read timed out")
            return original(method, url, params)
        result = self.run_once(timeout_on_reply)
        self.assertIn("댓글 실패", result)
        self.assertEqual(self.saved()["a"]["post_id"], "p1")

    def test_cap_counts_failed_posts_that_may_have_gone_live(self):
        prior = [item(f"d{i}", at=f"2026-10-28T0{i}:00+09:00", status="올림") for i in range(1, 5)]
        prior.append({**item("f", at="2026-10-28T08:00+09:00", status="실패"), "note": "게시 실패: timeout"})
        self.write(prior + [item("a")])
        self.assertIn("상한", self.run_once(FakeHttp()))

    def test_daily_cap(self):
        done = [item(f"d{i}", at=f"2026-10-28T0{i}:00+09:00", status="올림") for i in range(1, 6)]
        self.write(done + [item("a")])
        http = FakeHttp()
        self.assertIn("상한", self.run_once(http))
        self.assertEqual(self.saved()["a"]["status"], "실패")
        self.assertFalse([c for c in http.calls if c[0].startswith("threads")])

    def test_invalid_item_is_failed_without_posting(self):
        self.write([item("a", reply="링크 없음")])
        http = FakeHttp()
        self.assertIn("올리지 않음", self.run_once(http))
        self.assertEqual(http.calls, [])


class SessionTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "q.json"

    def tearDown(self):
        self.dir.cleanup()

    def test_waits_for_each_post_in_turn(self):
        self.path.write_text(json.dumps([
            item("a", at="2026-10-28T09:30+09:00"), item("b", at="2026-10-28T11:00+09:00"),
        ]), encoding="utf-8")
        clock = {"now": NOW}
        slept, ran = [], []

        def sleep(s):
            slept.append(s)
            clock["now"] += timedelta(seconds=s)

        def run(now):
            items = pp.load_queue(self.path)
            first = min((it for it in items if it["status"] == "예약"), key=lambda it: it["publish_at"])
            pp.save_queue(pp.with_status(items, first["id"], status="올림"), self.path)
            ran.append((first["id"], now))
            return first["id"]

        result = pp.session("tok", clock=lambda: clock["now"], sleep=sleep, pull=lambda: True, run=run,
                            path=self.path)
        self.assertEqual(result, ["a", "b"])
        self.assertEqual([r[1].strftime("%H:%M") for r in ran], ["09:30", "11:00"])

    def test_ignores_posts_beyond_session_window(self):
        self.path.write_text(json.dumps([item("a", at="2026-10-28T20:00+09:00")]), encoding="utf-8")
        result = pp.session("tok", clock=lambda: NOW, sleep=lambda s: None, pull=lambda: True,
                            run=lambda now: "ran", path=self.path)
        self.assertEqual(result, ["올릴 글 없음"])

    def test_stops_when_latest_queue_cannot_be_pulled(self):
        self.path.write_text(json.dumps([item("a", at="2026-10-28T09:30+09:00")]), encoding="utf-8")
        with self.assertRaises(SystemExit):
            pp.session("tok", clock=lambda: NOW, sleep=lambda s: None, pull=lambda: False,
                       run=lambda now: "ran", path=self.path)


class RefreshTest(unittest.TestCase):
    def test_refresh_stores_new_token_in_pickharu_secret(self):
        gh, masked = FakeGitHub(), []
        result = pp.refresh("OLD", "o/r", "pat", FakeHttp(), gh=gh,
                            encrypt=lambda k, v: f"enc({k},{v})", mask=masked.append)
        self.assertIn("60일", result)
        self.assertEqual(masked, ["NEW"])
        self.assertEqual(gh.calls[-1][1], "/repos/o/r/actions/secrets/PICKHARU_THREADS_ACCESS_TOKEN")

    def test_refresh_refuses_other_account(self):
        gh = FakeGitHub()
        with self.assertRaises(pp.ThreadsError):
            pp.refresh("OLD", "o/r", "pat", FakeHttp(username="heeya.dailyfit"), gh=gh,
                       encrypt=lambda k, v: v)
        self.assertEqual(gh.calls, [])


if __name__ == "__main__":
    unittest.main()
