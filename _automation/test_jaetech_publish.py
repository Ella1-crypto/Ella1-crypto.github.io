import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jaetech_publish as jp  # noqa: E402

NOW = datetime(2026, 10, 19, 12, 12, tzinfo=jp.KST)


def item(i, at, text="연말정산 전에 연금저축 납입액 확인해 봤어?", status="예약"):
    return {"id": i, "publish_at": at, "text": text, "status": status}


class FakeHttp:
    def __init__(self, fail_publish=0):
        self.calls = []
        self.fail_publish = fail_publish

    def __call__(self, method, url, params):
        self.calls.append(url.rsplit("/", 1)[-1])
        if url.endswith("/threads"):
            return {"id": "c1"}
        if url.endswith("/threads_publish"):
            if self.fail_publish:
                self.fail_publish -= 1
                raise jp.ThreadsError("HTTP 400: not ready")
            return {"id": "p1"}
        return {"username": "heeya.dailyfit", "id": "u1"}


class RunOnceTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "q.json"
        self.commits = []

    def tearDown(self):
        self.dir.cleanup()

    def write(self, items):
        self.path.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")

    def run_once(self, http, commit_ok=True):
        def commit(msg):
            self.commits.append((msg, json.loads(self.path.read_text(encoding="utf-8"))))
            return commit_ok
        return jp.run_once(NOW, "tok", "u1", http, commit, sleep=lambda s: None, path=self.path)

    def statuses(self):
        return {it["id"]: it["status"] for it in jp.load_queue(self.path)}

    def test_publishes_due_post_and_marks_in_progress_first(self):
        self.write([item("a", "2026-10-19T12:10+09:00")])
        result = self.run_once(FakeHttp())
        self.assertIn("p1", result)
        self.assertEqual(self.commits[0][1][0]["status"], "올리는 중")
        self.assertEqual(self.statuses(), {"a": "올림"})

    def test_does_not_publish_when_in_progress_commit_fails(self):
        self.write([item("a", "2026-10-19T12:10+09:00")])
        http = FakeHttp()
        result = self.run_once(http, commit_ok=False)
        self.assertIn("올리지 않음", result)
        self.assertEqual(http.calls, [])

    def test_future_post_is_left_alone(self):
        self.write([item("a", "2026-10-19T12:40+09:00")])
        http = FakeHttp()
        self.assertEqual(self.run_once(http), "올릴 글 없음")
        self.assertEqual(self.statuses(), {"a": "예약"})
        self.assertEqual(http.calls, [])

    def test_late_post_fails_without_publishing(self):
        self.write([item("a", "2026-10-19T07:00+09:00")])
        http = FakeHttp()
        self.run_once(http)
        self.assertEqual(self.statuses(), {"a": "실패"})
        self.assertEqual(http.calls, [])

    def test_text_with_link_is_blocked(self):
        self.write([item("a", "2026-10-19T12:10+09:00", text="여기 봐 https://x.com")])
        http = FakeHttp()
        self.assertIn("주소", self.run_once(http))
        self.assertEqual(http.calls, [])

    def test_post_three_hours_late_still_publishes(self):
        self.write([item("a", "2026-10-19T09:30+09:00")])
        self.run_once(FakeHttp())
        self.assertEqual(self.statuses(), {"a": "올림"})

    def test_only_one_post_per_run(self):
        self.write([item("a", "2026-10-19T12:05+09:00"), item("b", "2026-10-19T12:10+09:00")])
        self.run_once(FakeHttp())
        self.assertEqual(self.statuses(), {"a": "올림", "b": "예약"})

    def test_publish_retries_once_then_records_failure(self):
        self.write([item("a", "2026-10-19T12:10+09:00")])
        with self.assertRaises(SystemExit):
            self.run_once(FakeHttp(fail_publish=2))
        self.assertEqual(self.statuses(), {"a": "실패"})

    def test_publish_succeeds_on_retry(self):
        self.write([item("a", "2026-10-19T12:10+09:00")])
        self.run_once(FakeHttp(fail_publish=1))
        self.assertEqual(self.statuses(), {"a": "올림"})

    def wait_then_run(self, now, pull_ok=True):
        self.slept, self.pulls, self.ran = [], [], []
        def clock():
            return now + jp.timedelta(seconds=sum(self.slept))

        def pull():
            self.pulls.append(1)
            return pull_ok

        def run(at):
            self.ran.append(at)
            return "ran"
        return jp.wait_then_run("tok", "u1", clock=clock, sleep=self.slept.append,
                                pull=pull, run=run, path=self.path)

    def test_wait_sleeps_until_publish_time_then_pulls_and_runs(self):
        self.write([item("a", "2026-10-19T12:10+09:00")])
        result = self.wait_then_run(datetime(2026, 10, 19, 11, 42, tzinfo=jp.KST))
        self.assertEqual(result, "ran")
        self.assertEqual(self.slept, [28 * 60])
        self.assertEqual(self.pulls, [1])
        self.assertEqual(self.ran, [datetime(2026, 10, 19, 12, 10, tzinfo=jp.KST)])

    def test_wait_runs_immediately_when_post_is_already_due(self):
        self.write([item("a", "2026-10-19T12:10+09:00")])
        self.assertEqual(self.wait_then_run(NOW), "ran")
        self.assertEqual((self.slept, self.pulls), ([], []))

    def test_wait_uses_earliest_ready_post(self):
        self.write([item("b", "2026-10-19T13:10+09:00"), item("a", "2026-10-19T12:10+09:00"),
                    item("x", "2026-10-19T11:50+09:00", status="올림")])
        self.wait_then_run(datetime(2026, 10, 19, 11, 40, tzinfo=jp.KST))
        self.assertEqual(self.slept, [30 * 60])

    def test_wait_skips_when_next_post_is_beyond_max_wait(self):
        self.write([item("a", "2026-10-19T14:00+09:00")])
        result = self.wait_then_run(datetime(2026, 10, 19, 11, 40, tzinfo=jp.KST))
        self.assertIn("올릴 글 없음", result)
        self.assertEqual((self.slept, self.ran), ([], []))

    def test_wait_skips_when_queue_has_no_ready_post(self):
        self.write([item("a", "2026-10-19T12:10+09:00", status="올림")])
        self.assertIn("올릴 글 없음", self.wait_then_run(NOW))
        self.assertEqual(self.ran, [])

    def test_wait_does_not_publish_when_pull_fails_after_sleeping(self):
        self.write([item("a", "2026-10-19T12:10+09:00")])
        with self.assertRaises(SystemExit):
            self.wait_then_run(datetime(2026, 10, 19, 11, 42, tzinfo=jp.KST), pull_ok=False)
        self.assertEqual(self.ran, [])

    def test_wait_end_to_end_publishes_with_fresh_queue(self):
        self.write([item("a", "2026-10-19T12:10+09:00")])
        start = datetime(2026, 10, 19, 11, 45, tzinfo=jp.KST)
        slept = []
        result = jp.wait_then_run(
            "tok", "u1", clock=lambda: start + jp.timedelta(seconds=sum(slept)), sleep=slept.append,
            pull=lambda: True,
            run=lambda at: jp.run_once(at, "tok", "u1", FakeHttp(), lambda m: True,
                                       sleep=lambda s: None, path=self.path),
            path=self.path)
        self.assertIn("p1", result)
        self.assertEqual(self.statuses(), {"a": "올림"})

    def test_check_token_rejects_other_account(self):
        http = lambda m, u, p: {"username": "someone"}
        with self.assertRaises(jp.ThreadsError):
            jp.check_token("tok", http)


if __name__ == "__main__":
    unittest.main()


class ReplyTest(RunOnceTest):
    def test_reply_is_posted_as_first_comment(self):
        it = item("a", "2026-10-19T12:10+09:00")
        it["reply"] = "무료 목록 https://example.org/x"
        self.write([it])
        http = FakeHttp()
        self.run_once(http)
        saved = jp.load_queue(self.path)[0]
        self.assertEqual(saved["status"], "올림")
        self.assertEqual(saved["reply_id"], "p1")
        self.assertEqual(http.calls.count("threads"), 2)

    def test_reply_failure_keeps_post_published(self):
        it = item("a", "2026-10-19T12:10+09:00")
        it["reply"] = "링크 https://example.org/x"
        self.write([it])
        http = FakeHttp()
        original = http.__call__

        def flaky(method, url, params):
            if "reply_to_id" in params:
                raise jp.ThreadsError("HTTP 400: reply fail")
            return original(method, url, params)
        result = jp.run_once(NOW, "tok", "u1", flaky, lambda m: True, sleep=lambda s: None, path=self.path)
        saved = jp.load_queue(self.path)[0]
        self.assertIn("댓글 실패", result)
        self.assertEqual(saved["status"], "올림")
        self.assertIn("reply_error", saved)

    def test_placeholder_in_reply_blocks_post(self):
        it = item("a", "2026-10-19T12:10+09:00")
        it["reply"] = "템플릿은 [크몽]"
        self.write([it])
        http = FakeHttp()
        self.assertIn("올리지 않음", self.run_once(http))
        self.assertEqual(http.calls, [])


class WatchTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "q.json"
        self.t = datetime(2026, 10, 29, 2, 0, tzinfo=jp.KST)
        self.ran = []

    def tearDown(self):
        self.dir.cleanup()

    def go(self, items):
        self.path.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")

        def sleep(sec):
            self.t = self.t + jp.timedelta(seconds=sec)

        def run(now):
            self.ran.append(now)
            q = jp.load_queue(self.path)
            q = [{**i, "status": "올림"} if i["status"] == "예약" and datetime.fromisoformat(i["publish_at"]) <= now else i
                 for i in q]
            self.path.write_text(json.dumps(q, ensure_ascii=False), encoding="utf-8")
            return "ran"
        return jp.watch("tok", "u1", clock=lambda: self.t, sleep=sleep, pull=lambda: True, run=run, path=self.path)

    def test_publishes_at_time_within_limit_then_stops(self):
        relay = self.go([item("a", "2026-10-29T07:30+09:00")])
        self.assertEqual(len(self.ran), 1)
        self.assertEqual(self.ran[0], datetime(2026, 10, 29, 7, 30, tzinfo=jp.KST))
        self.assertFalse(relay)

    def test_relays_when_next_post_is_beyond_limit(self):
        relay = self.go([item("a", "2026-10-29T13:00+09:00")])
        self.assertEqual(self.ran, [])
        self.assertTrue(relay)

    def test_handles_two_posts_in_one_watch(self):
        relay = self.go([item("a", "2026-10-29T03:00+09:00"), item("b", "2026-10-29T07:30+09:00"),
                         item("c", "2026-10-30T07:30+09:00")])
        self.assertEqual(len(self.ran), 2)
        self.assertTrue(relay)
