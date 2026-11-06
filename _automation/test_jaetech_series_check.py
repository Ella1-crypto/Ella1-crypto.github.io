import sys
import unittest
import unittest.mock
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jaetech_series_check as sc  # noqa: E402

TODAY = date(2026, 11, 3)


def item(i, at, status="예약"):
    return {"id": i, "publish_at": at, "status": status}


FULL = [item("jt-20261103-pm", "2026-11-03T18:00+09:00"),
        item("ai-20261104-am", "2026-11-04T09:30+09:00"), item("ai-20261104-pm", "2026-11-04T20:30+09:00"),
        item("r2-20261104", "2026-11-04T07:30+09:00")]


class MissingTest(unittest.TestCase):
    def test_full_has_no_gaps(self):
        self.assertEqual(sc.missing(FULL, TODAY), [])

    def test_reports_each_gap(self):
        gaps = sc.missing(FULL[:1], TODAY)
        self.assertEqual(len(gaps), 2)
        self.assertIn("AI 노하우 11/04: 0/1", gaps[0])
        self.assertIn("free-course-series", gaps[1])

    def test_one_ai_post_a_day_is_enough(self):
        # 2026-11-05 운영 전략: AI 노하우 하루 2개 → 1개 (09:30만)
        items = [FULL[0], FULL[1], FULL[3]]
        self.assertEqual(sc.missing(items, TODAY), [])

    def test_failed_and_wrong_shape_not_counted(self):
        items = [item("jt-20261103", "2026-11-03T13:00+09:00", "실패"),
                 item("r2-ai-20261104", "2026-11-04T07:30+09:00")] + FULL[1:3]
        gaps = sc.missing(items, TODAY)
        self.assertTrue(any("재테크" in g for g in gaps) and any("무료강의" in g for g in gaps))

    def test_send_needs_secrets(self):
        sent = []
        with unittest.mock.patch.dict(sc.os.environ, {}, clear=True):
            self.assertFalse(sc.send("x", lambda *a: sent.append(a)))
        with unittest.mock.patch.dict(sc.os.environ, {"HEEYA_TELEGRAM_TOKEN": "t", "HEEYA_TELEGRAM_CHAT_ID": "1"}):
            self.assertTrue(sc.send("x", lambda *a: sent.append(a)))
        self.assertEqual(sent[0][2], {"chat_id": "1", "text": "x"})


if __name__ == "__main__":
    unittest.main()
