import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jaetech_publish as jp  # noqa: E402
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

    def test_naver_allows_up_to_three_option_links(self):
        naver = {**item("n", text="퇴근길 선물 고민이면 이거\n[광고] 네이버 브랜드 커넥트"), "kind": "네이버"}
        links = ["https://naver.me/AAA1", "https://naver.me/BBB2", "https://naver.me/CCC3", "https://naver.me/DDD4"]
        three = "\n".join(links[:3])
        self.assertEqual(pp.problem_of({**naver, "reply": f"{three}\n\n{pp.NAVER_DISCLOSURE}"}), "")
        four = "\n".join(links)
        self.assertIn("링크", pp.problem_of({**naver, "reply": f"{four}\n\n{pp.NAVER_DISCLOSURE}"}))
        mixed = f"https://naver.me/AAA1\n{KAKAO_LINK}\n\n{pp.NAVER_DISCLOSURE}"
        self.assertIn("링크", pp.problem_of({**naver, "reply": mixed}))

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

    def test_thread_replies_chain_under_link_reply(self):
        self.write([{**item("t"), "thread": ["둘째 타래", "셋째 타래"]}])
        http = FakeHttp()
        self.run_once(http)
        replies = [p for name, p in http.calls if name == "threads" and "reply_to_id" in p]
        self.assertEqual([r["reply_to_id"] for r in replies], ["p1", "p2", "p3"])
        self.assertEqual(replies[2]["text"], "셋째 타래")
        self.assertEqual(self.saved()["t"]["thread_ids"], ["p3", "p4"])

    def test_thread_skipped_when_link_reply_fails(self):
        self.write([{**item("t"), "thread": ["둘째 타래"]}])
        http = FakeHttp(fail_reply=True)
        self.run_once(http)
        self.assertEqual(sum(1 for name, p in http.calls if name == "threads" and "reply_to_id" in p), 1)
        self.assertNotIn("thread_ids", self.saved()["t"])

    def test_quote_of_quotes_old_post_only_on_body(self):
        self.write([{**item("q"), "quote_of": "17942087787383832"}])
        http = FakeHttp()
        self.run_once(http)
        posts = [p for name, p in http.calls if name == "threads"]
        self.assertEqual(posts[0]["quote_post_id"], "17942087787383832")
        self.assertNotIn("quote_post_id", posts[1])  # 링크 댓글은 인용하지 않음

    def test_quote_of_must_be_number(self):
        self.assertIn("quote_of", pp.problem_of({**item("q"), "quote_of": "DfMoN1eFiEk"}))

    def test_followup_posts_blog_link_under_existing_post(self):
        done = [item(f"d{i}", at=f"2026-10-28T0{i}:00+09:00", status="올림") for i in range(1, 3)]
        follow = {"id": "bl-1", "kind": "덧글", "reply_to_post": "18156012862490251",
                  "publish_at": "2026-10-28T09:00+09:00", "status": "예약",
                  "text": "블로그에 자세히 정리해 뒀어 👉\nhttps://blog.naver.com/goghibli/224459047883"}
        self.write(done + [follow])
        http = FakeHttp()
        self.assertIn("p1", self.run_once(http))  # 쿠팡 하루 상한(2)과 상관없이 올라간다
        posts = [p for name, p in http.calls if name == "threads"]
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]["reply_to_id"], "18156012862490251")
        self.assertEqual(self.saved()["bl-1"]["status"], "올림")

    def test_followup_rules(self):
        ok = {"id": "bl", "kind": "덧글", "reply_to_post": "123", "status": "예약",
              "text": "블로그에 정리했어 👉 https://blog.naver.com/goghibli/224459047883"}
        self.assertEqual(pp.problem_of(ok), "")
        self.assertIn("글 번호", pp.problem_of({**ok, "reply_to_post": ""}))
        self.assertIn("블로그", pp.problem_of({**ok, "text": "보러 가기 https://link.coupang.com/a/x"}))
        self.assertIn("블로그", pp.problem_of({**ok, "text": ok["text"] + " https://blog.naver.com/goghibli/1"}))

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

    def test_total_cap_four_across_kinds_from_nov8(self):
        # 2026-11-05 사용자 "발행 수를 조정": 블프가 끝난 11/8부터 종류 합쳐 하루 4개
        now = datetime(2026, 11, 8, 19, 2, tzinfo=pp.KST)
        done = [kakao("k1", at="2026-11-08T13:40+09:00", status="올림"),
                {"id": "g1", "kind": "일반", "publish_at": "2026-11-08T08:30+09:00", "text": "다들 점심 뭐 먹어?", "status": "올림"},
                item("c1", at="2026-11-08T12:10+09:00", status="올림"),
                {**kakao("n1", at="2026-11-08T16:25+09:00", status="올림"), "kind": "네이버"}]
        general2 = {"id": "g2", "kind": "일반", "publish_at": "2026-11-08T19:00+09:00", "text": "다들 저녁 뭐 먹어?", "status": "예약"}
        self.write(done + [general2])  # 일반 글 상한(2)은 남아 있어도 종류 합계 4개면 막힘
        self.assertIn("전체 상한", self.run_once(FakeHttp(), now=now))

    def test_followup_does_not_count_toward_total_cap(self):
        now = datetime(2026, 11, 8, 19, 2, tzinfo=pp.KST)
        done = [{**kakao("n1", at="2026-11-08T13:25+09:00", status="올림"), "kind": "네이버"},
                item("c1", at="2026-11-08T12:10+09:00", status="올림"),
                {"id": "x1", "kind": "일반", "publish_at": "2026-11-08T08:30+09:00", "text": "다들 점심 뭐 먹어?", "status": "올림"},
                {"id": "bl", "kind": "덧글", "publish_at": "2026-11-08T13:41+09:00", "status": "올림"},
                {"id": "bl2", "kind": "덧글", "publish_at": "2026-11-08T13:42+09:00", "status": "올림"}]
        self.write(done + [kakao("k2", at="2026-11-08T19:00+09:00")])
        self.assertIn("p1", self.run_once(FakeHttp(), now=now))

    def test_kakao_and_naver_one_per_day_from_nov8(self):
        self.assertEqual(pp.cap_of("카카오", datetime(2026, 11, 7, 12, 0, tzinfo=pp.KST)), 3)
        self.assertEqual(pp.cap_of("카카오", datetime(2026, 11, 8, 12, 0, tzinfo=pp.KST)), 1)
        self.assertEqual(pp.cap_of("네이버", datetime(2026, 11, 9, 12, 0, tzinfo=pp.KST)), 1)

    def test_total_cap_not_applied_before_nov8(self):
        self.assertIsNone(pp.total_cap(datetime(2026, 11, 7, 12, 0, tzinfo=pp.KST)))
        self.assertEqual(pp.total_cap(datetime(2026, 11, 8, 0, 0, tzinfo=pp.KST)), 4)

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


class RelayDelayTest(unittest.TestCase):
    # NOW = 10/28 09:02
    def at(self, when: str, status: str = pp.READY) -> dict:
        return {"id": when, "publish_at": f"2026-10-28T{when}+09:00", "status": status}

    def test_returns_none_when_nothing_scheduled(self):
        self.assertIsNone(pp.relay_delay([self.at("10:00", pp.DONE), self.at("11:00", pp.FAILED)], NOW))

    def test_far_post_caps_at_max(self):
        items = [{"id": "x", "publish_at": "2026-10-29T07:30+09:00", "status": pp.READY}]
        self.assertEqual(pp.relay_delay(items, NOW), pp.RELAY_MAX.total_seconds())

    def test_starts_lead_time_before_medium_post(self):
        self.assertEqual(pp.relay_delay([self.at("16:02")], NOW), 120 * 60)  # 7시간 뒤 → 2시간 쉬고 부름

    def test_near_or_overdue_post_uses_minimum_gap(self):
        self.assertEqual(pp.relay_delay([self.at("09:30")], NOW), pp.RELAY_MIN.total_seconds())
        self.assertEqual(pp.relay_delay([self.at("07:00")], NOW), pp.RELAY_MIN.total_seconds())

    def test_ignores_posts_past_late_limit(self):
        self.assertIsNone(pp.relay_delay([self.at("04:00")], NOW))

    def test_ignores_bad_time(self):
        self.assertIsNone(pp.relay_delay([{"id": "x", "publish_at": "언젠가", "status": pp.READY}], NOW))


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


class OliveYoungTest(unittest.TestCase):
    """올리브영 쇼핑 큐레이터: 본문 마지막 줄 [광고], 링크·공식 문구는 댓글에(2026-11-03 사용자: 첫머리 문구 뺌)."""
    LINK = "https://oy.run/lSiE9bpu6f2JEE"
    BODY = "크림 고를 때 참고해\n스치니들은 뭐 써?\n[광고] 올리브영 쇼핑 큐레이터"

    def oy(self, **kw):
        return {**item("o", text=self.BODY, reply=f"보기 👉 {self.LINK}\n\n{pp.OY_DISCLOSURE}"), "kind": "올영", **kw}

    def test_ok_without_top_disclosure(self):
        self.assertEqual(pp.problem_of(self.oy()), "")

    def test_disclosure_still_required_in_reply_and_tag_at_end(self):
        self.assertIn("고지", pp.problem_of(self.oy(reply=f"보기 👉 {self.LINK}")))
        self.assertIn("마지막 줄", pp.problem_of(self.oy(text="크림 고를 때 참고해\n스치니들은 뭐 써?")))

    def test_link_format(self):
        self.assertIn("링크", pp.problem_of(self.oy(reply=f"https://www.oliveyoung.co.kr/x\n{pp.OY_DISCLOSURE}")))

    def test_thread_replies_checked_like_reply(self):
        self.assertEqual(pp.problem_of(self.oy(thread=[f"② 두 번째 상품\n👉 {self.LINK}"])), "")
        self.assertIn("타래", pp.problem_of(self.oy(thread=["가" * 501])))
        self.assertIn("타래", pp.problem_of(self.oy(thread=["https://link.coupang.com/a/x"])))
        self.assertIn("타래", pp.problem_of(self.oy(thread=["너는 이거 써?"])))
        self.assertIn("타래", pp.problem_of(self.oy(thread="한 줄")))

    def test_black_friday_cap(self):
        self.assertEqual(pp.cap_of("올영", datetime(2026, 11, 7, 21, 10, tzinfo=pp.KST)), 6)
        self.assertEqual(pp.cap_of("올영", datetime(2026, 11, 8, 12, 50, tzinfo=pp.KST)), 2)
        self.assertEqual(pp.cap_of("쿠팡", datetime(2026, 11, 5, 12, 10, tzinfo=pp.KST)), pp.DAILY_CAP)


class NotifyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "q.json"
        self.path.write_text(json.dumps([{"id": "kk-1", "text": "첫 줄\n둘째","reply_error": "링크 댓글 실패: x"}],
                                        ensure_ascii=False), encoding="utf-8")
        self.calls = []
        self.http = lambda method, url, params: self.calls.append((url, params)) or {}
        self.env = dict(pp.os.environ)
        pp.os.environ.update(PICKHARU_TELEGRAM_TOKEN="bot", PICKHARU_TELEGRAM_CHAT_ID="7")

    def tearDown(self):
        pp.os.environ.clear()
        pp.os.environ.update(self.env)
        self.tmp.cleanup()

    def test_sends_result_with_first_line(self):
        text = pp.notify("올림: kk-1 → 99 (댓글 실패)", self.path, self.http)
        self.assertEqual(self.calls[0][1]["chat_id"], "7")
        self.assertTrue(text.startswith("⚠️"))
        self.assertIn("첫 줄", text)
        self.assertIn("링크 댓글 실패", text)

    def test_success_icon(self):
        self.path.write_text(json.dumps([{"id": "kk-1", "text": "첫 줄"}]), encoding="utf-8")
        self.assertTrue(pp.notify("올림: kk-1 → 99", self.path, self.http).startswith("✅"))

    def test_skips_nothing_to_post_and_missing_secret(self):
        self.assertEqual(pp.notify("올릴 글 없음", self.path, self.http), "")
        del pp.os.environ["PICKHARU_TELEGRAM_CHAT_ID"]
        self.assertEqual(pp.notify("올림: kk-1 → 99", self.path, self.http), "")
        self.assertEqual(self.calls, [])

    def test_failure_does_not_raise(self):
        def broken(method, url, params):
            raise pp.ThreadsError("down")
        self.assertIn("kk-1", pp.notify("올리는 중 표시를 저장하지 못해 올리지 않음 (kk-1)", self.path, broken))

class CodeChangeRestartTest(unittest.TestCase):
    """2026-11-03: 옛 코드로 기다리던 실행이 새 '정보' 글을 '알 수 없는 글 종류'로 실패 처리한 사고."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "queue.json"
        self.path.write_text(json.dumps([item("a", at="2026-10-28T09:30+09:00")]), encoding="utf-8")

    def tearDown(self):
        self.dir.cleanup()

    def test_session_checks_code_after_every_pull_before_running(self):
        order = []

        def restart(end):
            order.append(("restart", end))

        def run(now):
            order.append(("run", now))
            pp.save_queue(pp.with_status(pp.load_queue(self.path), "a", status="올림"), self.path)
            return "a"

        pp.session("tok", clock=lambda: NOW, sleep=lambda s: None, pull=lambda: order.append(("pull",)) or True,
                   run=run, path=self.path, restart=restart)
        names = [o[0] for o in order]
        self.assertEqual(names[:2], ["pull", "restart"])
        self.assertLess(names.index("restart", 2), names.index("run"))  # 기다린 뒤 pull → 코드 확인 → 올리기
        self.assertEqual(order[1][1], NOW + pp.MAX_SESSION)

    def test_changed_code_restarts_with_same_end_time(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "x.py").write_text("A = 1\n", encoding="utf-8")
            started = jp.code_fingerprint(root)
            calls = []
            end = NOW + pp.MAX_SESSION
            jp.restart_if_code_changed(end, started, execv=lambda *a: calls.append(a), root=root)
            self.assertEqual(calls, [])  # 그대로면 다시 시작하지 않음
            (root / "x.py").write_text("A = 2\n", encoding="utf-8")
            saved = os.environ.pop(jp.SESSION_END_ENV, None)
            try:
                jp.restart_if_code_changed(end, started, execv=lambda *a: calls.append(a), root=root)
                self.assertEqual(len(calls), 1)
                self.assertEqual(os.environ[jp.SESSION_END_ENV], end.isoformat())
                later = NOW + timedelta(minutes=100)
                self.assertEqual(jp.session_end(later, pp.MAX_SESSION), end)  # 처음 실행의 끝을 넘지 않음
            finally:
                os.environ.pop(jp.SESSION_END_ENV, None)
                if saved is not None:
                    os.environ[jp.SESSION_END_ENV] = saved

    def test_session_end_without_inherited_time(self):
        saved = os.environ.pop(jp.SESSION_END_ENV, None)
        try:
            self.assertEqual(jp.session_end(NOW, pp.MAX_SESSION), NOW + pp.MAX_SESSION)
        finally:
            if saved is not None:
                os.environ[jp.SESSION_END_ENV] = saved


if __name__ == "__main__":
    unittest.main()


INFO_TEXT = "쿠팡 와우회원 스치니들\n오늘 오후 5시 알람 맞춰 둬⏰\n선착순 쿠폰이 풀린대🤍"
INFO_REPLY = "출처: https://ir.newspim.com/news/view/20261102000083\n\n조건은 바뀔 수 있어서 원문 한 번 더 확인해 줘"


def info(i, at="2026-10-28T09:00+09:00", **kw):
    return {"id": i, "kind": "정보", "publish_at": at, "text": INFO_TEXT, "reply": INFO_REPLY, "status": "예약", **kw}


class InfoRuleTest(unittest.TestCase):
    def test_info_post_needs_no_ad_tag(self):
        self.assertEqual(pp.problem_of(info("i")), "")

    def test_info_reply_needs_one_to_three_source_links(self):
        self.assertIn("출처 링크", pp.problem_of(info("i", reply="출처는 기사예요")))
        many = "\n".join(f"https://a.kr/{n}" for n in range(4))
        self.assertIn("출처 링크", pp.problem_of(info("i", reply=many)))

    def test_info_reply_blocks_affiliate_links(self):
        for url in ("https://link.coupang.com/a/abc", "https://gift-link.kakao.com/c/x1", "https://naver.me/ab12",
                    "https://oy.run/abc", "https://appu.kr/xyz", "https://click.linkprice.com/x",
                    "https://www.coupang.com/vp/products/1?lptag=AF123"):
            with self.subTest(url=url):
                self.assertIn("제휴 링크", pp.problem_of(info("i", reply=f"출처: {url}")))
        self.assertIn("제휴 링크", pp.problem_of(info("i", thread=["https://oy.run/abc"])))

    def test_info_reply_allows_plain_official_pages(self):
        reply = "출처: https://www.coupang.com/np/campaigns/123\nhttps://www.newsis.com/view/NISX1"
        self.assertEqual(pp.problem_of(info("i", reply=reply)), "")

    def test_info_reply_must_not_copy_body(self):
        copied = INFO_REPLY + "\n오늘 오후 5시 알람 맞춰 둬⏰"
        self.assertIn("옮겨", pp.problem_of(info("i", reply=copied)))

    def test_info_body_still_blocks_links_and_neo(self):
        self.assertIn("주소", pp.problem_of(info("i", text=INFO_TEXT + "\nhttps://a.kr/x")))
        self.assertIn("너", pp.problem_of(info("i", text="너는 뭐 담았어?")))

    def test_expired(self):
        self.assertTrue(pp.expired(info("i", expires_at="2026-10-28T09:00+09:00"), NOW))
        self.assertFalse(pp.expired(info("i", expires_at="2026-10-28T17:00"), NOW))
        self.assertFalse(pp.expired(info("i"), NOW))


class InfoRunOnceTest(RunOnceTest):
    def test_info_post_gets_source_reply(self):
        self.write([info("i")])
        http = FakeHttp()
        self.assertIn("p1", self.run_once(http))
        replies = [p for n, p in http.calls if "reply_to_id" in p]
        self.assertEqual(replies[0]["text"], INFO_REPLY)

    def test_expired_info_post_is_not_published(self):
        self.write([info("i", expires_at="2026-10-28T09:01+09:00")])
        http = FakeHttp()
        self.assertIn("지나", self.run_once(http))
        self.assertFalse([c for c in http.calls if c[0] == "threads"])
        self.assertEqual(self.saved()["i"]["status"], "실패")

    def test_info_cap_is_four(self):
        done = [info(f"d{n}", at=f"2026-10-28T0{n}:00+09:00", status="올림") for n in range(1, 5)]
        self.write(done + [info("i")])
        self.assertIn("상한", self.run_once(FakeHttp()))
