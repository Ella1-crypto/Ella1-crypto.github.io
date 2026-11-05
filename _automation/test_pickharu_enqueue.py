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


class SlotPlanTest(unittest.TestCase):
    """2026-10-30 운영안: 쿠팡 12:10·15:10, 카카오·네이버는 그 사이 13시·16시·19시를 나눠 씀, 일반 글 08:30·20:30."""
    NOW = datetime(2026, 10, 31, 7, 0, tzinfo=pe.KST)

    def hhmm(self, times):
        return [t.strftime("%m-%d %H:%M") for t in times]

    def test_coupang_two_slots_then_next_day(self):
        self.assertEqual(self.hhmm(pe.plan_times("쿠팡", 3, [], self.NOW)),
                         ["10-31 12:10", "10-31 15:10", "11-01 12:10"])

    def test_kakao_and_naver_share_hours_between_coupang(self):
        queue = [{"id": "kk-1", "kind": "카카오", "publish_at": "2026-10-31T13:40+09:00", "status": "예약"}]
        self.assertEqual(self.hhmm(pe.plan_times("네이버", 2, queue, self.NOW)), ["10-31 16:25", "10-31 19:25"])

    def test_held_or_failed_items_do_not_take_a_slot(self):
        queue = [{"id": "ph-1", "publish_at": "2026-10-31T12:10+09:00", "status": "보류"}]
        self.assertEqual(self.hhmm(pe.plan_times("쿠팡", 1, queue, self.NOW)), ["10-31 12:10"])

    def test_skips_slots_too_soon(self):
        now = datetime(2026, 10, 31, 11, 55, tzinfo=pe.KST)
        self.assertEqual(self.hhmm(pe.plan_times("쿠팡", 1, [], now)), ["10-31 15:10"])

    def test_general_posts_morning_and_evening(self):
        self.assertEqual(self.hhmm(pe.plan_times("일반", 2, [], self.NOW)), ["10-31 08:30", "10-31 20:30"])

    def test_build_without_start_uses_slots(self):
        queue = pe.build([draft(1), draft(2)], ["1", "2"], [], now=self.NOW)
        self.assertEqual([q["publish_at"] for q in queue], ["2026-10-31T12:10+09:00", "2026-10-31T15:10+09:00"])

    def test_coupang_cap_is_two(self):
        with self.assertRaises(ValueError):
            pe.build([draft(i) for i in (1, 2, 3)], ["1", "2", "3"], [], now=self.NOW)

    def test_full_day_of_four_pushes_to_next_day_from_nov8(self):
        # 2026-11-05 사용자 "발행 수를 조정": 11/8부터 종류 합쳐 하루 4개
        now = datetime(2026, 11, 8, 7, 0, tzinfo=pe.KST)
        queue = [{"id": "g", "kind": "일반", "publish_at": "2026-11-08T08:30+09:00", "status": "예약"},
                 {"id": "i", "kind": "정보", "publish_at": "2026-11-08T10:55+09:00", "status": "예약"},
                 {"id": "k", "kind": "카카오", "publish_at": "2026-11-08T13:40+09:00", "status": "예약"},
                 {"id": "o", "kind": "올영", "publish_at": "2026-11-08T17:50+09:00", "status": "예약"}]
        self.assertEqual(self.hhmm(pe.plan_times("쿠팡", 1, queue, now)), ["11-09 12:10"])

    def test_one_batch_of_mixed_kinds_respects_total_cap(self):
        now = datetime(2026, 11, 10, 7, 0, tzinfo=pe.KST)  # 화요일
        queue = [{"id": "g", "kind": "일반", "publish_at": "2026-11-10T08:30+09:00", "status": "예약"},
                 {"id": "i", "kind": "정보", "publish_at": "2026-11-10T10:55+09:00", "status": "예약"},
                 {"id": "o", "kind": "올영", "publish_at": "2026-11-10T17:50+09:00", "status": "예약"}]
        k = {**draft(1, KAKAO_TEXT, KAKAO_REPLY), "id": "kk-20261110-1", "kind": "카카오"}
        new = pe.build([draft(1), k], ["ph-20261028-1", "kk-20261110-1"], queue, now=now)
        days = {q["id"]: q["publish_at"][:10] for q in new}  # build는 기존 예약까지 포함한 전체 목록을 돌려준다
        self.assertEqual(sum(d == "2026-11-10" for d in days.values()), 4)
        self.assertEqual(len(new), 5)

    def test_kakao_only_tue_thu_sat_and_naver_only_mon_wed_fri_from_nov8(self):
        # 2026-11-05 사용자 "카카오·네이버는 주 2~3회 … 주 3회·하루 1개"
        now = datetime(2026, 11, 8, 7, 0, tzinfo=pe.KST)  # 일요일
        self.assertEqual(self.hhmm(pe.plan_times("카카오", 2, [], now)), ["11-10 19:40", "11-12 19:40"])
        self.assertEqual(self.hhmm(pe.plan_times("네이버", 2, [], now)), ["11-09 19:25", "11-11 19:25"])

    def test_kakao_naver_one_per_day_from_nov8(self):
        now = datetime(2026, 11, 10, 7, 0, tzinfo=pe.KST)
        ks = [{**draft(n, KAKAO_TEXT, KAKAO_REPLY), "id": f"kk-20261110-{n}", "kind": "카카오"} for n in (1, 2)]
        with self.assertRaises(ValueError):
            pe.build(ks, ["kk-20261110-1", "kk-20261110-2"], [], now=now)

    def test_followups_do_not_fill_the_day(self):
        now = datetime(2026, 11, 8, 7, 0, tzinfo=pe.KST)
        queue = [{"id": f"bl{i}", "kind": "덧글", "publish_at": f"2026-11-08T1{i}:00+09:00", "status": "예약"} for i in range(5)]
        self.assertEqual(self.hhmm(pe.plan_times("쿠팡", 1, queue, now)), ["11-08 12:10"])

    def test_oliveyoung_four_slots_until_black_friday_ends(self):
        now = datetime(2026, 11, 7, 7, 0, tzinfo=pe.KST)
        self.assertEqual(self.hhmm(pe.plan_times("올영", 6, [], now)),
                         ["11-07 12:50", "11-07 15:50", "11-07 17:50", "11-07 21:10", "11-08 12:50", "11-08 17:50"])

    def test_thread_kept_in_queue(self):
        self.assertIn("thread", pe.QUEUE_FIELDS)


class InfoEnqueueTest(unittest.TestCase):
    NOW = datetime(2026, 11, 3, 15, 30, tzinfo=pe.KST)

    def info(self, n, **kw):
        from test_pickharu_publish import INFO_REPLY, INFO_TEXT
        return {"id": f"if-20261103-{n}", "kind": "정보", "text": INFO_TEXT, "reply": INFO_REPLY, **kw}

    def test_uses_proposed_time_and_keeps_expiry(self):
        d = self.info(1, publish_at="2026-11-03T16:15", expires_at="2026-11-03T17:00")
        it = pe.build([d], ["1"], [], now=self.NOW)[0]
        self.assertEqual(it["publish_at"], "2026-11-03T16:15+09:00")
        self.assertEqual(it["expires_at"], "2026-11-03T17:00")
        self.assertEqual(it["kind"], "정보")

    def test_refuses_proposed_time_already_passed(self):
        d = self.info(1, publish_at="2026-11-03T15:32")
        with self.assertRaisesRegex(ValueError, "지났"):
            pe.build([d], ["1"], [], now=self.NOW)

    def test_planned_slot_after_expiry_is_refused(self):
        d = self.info(1, expires_at="2026-11-03T18:00")  # 다음 빈 자리는 18:55
        with self.assertRaisesRegex(ValueError, "마감"):
            pe.build([d], ["1"], [], now=self.NOW)

    def test_without_time_takes_info_slot(self):
        it = pe.build([self.info(1)], ["1"], [], now=self.NOW)[0]
        self.assertEqual(it["publish_at"], "2026-11-03T18:55+09:00")

    def test_info_cap_four_per_batch(self):
        ds = [self.info(n) for n in range(1, 6)]
        with self.assertRaisesRegex(ValueError, "최대 4"):
            pe.build(ds, ["1", "2", "3", "4", "5"], [], now=self.NOW)
