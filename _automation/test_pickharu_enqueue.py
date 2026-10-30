import sys
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pickharu_enqueue as pe  # noqa: E402
from test_pickharu_publish import KAKAO_REPLY, KAKAO_TEXT, REPLY, TEXT  # noqa: E402

START = datetime(2026, 10, 28, 17, 10, tzinfo=pe.KST)


def draft(n, text=TEXT, reply=REPLY):
    return {"id": f"ph-20261028-{n}", "keyword": "k", "product": "p", "text": text, "reply": reply,
            "status": "초안", "reviews": 100}


class FirstSlotTest(unittest.TestCase):
    def test_next_ten_past_at_least_twenty_minutes_ahead(self):
        self.assertEqual(pe.first_slot(datetime(2026, 10, 28, 16, 45, tzinfo=pe.KST)).strftime("%H:%M"), "17:10")
        self.assertEqual(pe.first_slot(datetime(2026, 10, 28, 16, 55, tzinfo=pe.KST)).strftime("%H:%M"), "18:10")
        self.assertEqual(pe.first_slot(datetime(2026, 10, 28, 16, 40, tzinfo=pe.KST)).strftime("%H:%M"), "17:10")


class KakaoEnqueueTest(unittest.TestCase):
    def test_kakao_slot_is_forty_past_and_kind_kept(self):
        self.assertEqual(pe.first_slot(datetime(2026, 10, 28, 16, 15, tzinfo=pe.KST), 40).strftime("%H:%M"), "16:40")
        k = {**draft(1, KAKAO_TEXT, KAKAO_REPLY), "id": "kk-20261028-1", "kind": "카카오"}
        queue = pe.build([k], ["1"], [], START)
        self.assertEqual(queue[0]["kind"], "카카오")

    def test_kakao_cap_is_three(self):
        ks = [{**draft(n, KAKAO_TEXT, KAKAO_REPLY), "id": f"kk-20261028-{n}", "kind": "카카오"} for n in (1, 2, 3, 4)]
        self.assertEqual(len(pe.build(ks, ["1", "2", "3"], [], START)), 3)
        with self.assertRaises(ValueError):
            pe.build(ks, ["1", "2", "3", "4"], [], START)


class BuildTest(unittest.TestCase):
    def test_adds_only_chosen_drafts_hourly_as_ready(self):
        queue = pe.build([draft(1), draft(2), draft(3)], ["1", "3"], [], START)
        self.assertEqual([q["id"] for q in queue], ["ph-20261028-1", "ph-20261028-3"])
        self.assertEqual([q["publish_at"] for q in queue], ["2026-10-28T17:10+09:00", "2026-10-28T18:10+09:00"])
        self.assertTrue(all(q["status"] == "예약" for q in queue))
        self.assertNotIn("reviews", queue[0])

    def test_rejects_everything_if_one_draft_fails_checks(self):
        with self.assertRaises(ValueError):
            pe.build([draft(1), draft(2, reply="링크 없음")], ["1", "2"], [], START)

    def test_rejects_duplicates_and_unknown_ids(self):
        with self.assertRaises(ValueError):
            pe.build([draft(1)], ["1"], [{"id": "ph-20261028-1"}], START)
        with self.assertRaises(ValueError):
            pe.build([draft(1)], ["9"], [], START)

    def test_rejects_more_than_daily_cap(self):
        with self.assertRaises(ValueError):
            pe.build([draft(i) for i in range(1, 7)], [str(i) for i in range(1, 7)], [], START)


if __name__ == "__main__":
    unittest.main()
