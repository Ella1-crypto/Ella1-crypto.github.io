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
        self.assertIn("AI 팁·사용법 11/04: 0/1", gaps[0])
        self.assertIn("free-course-series", gaps[1])

    def test_one_ai_post_a_day_is_enough(self):
        # 2026-11-05 운영 전략: AI 노하우 하루 2개 → 1개 (09:30만)
        items = [FULL[0], FULL[1], FULL[3]]
        self.assertEqual(sc.missing(items, TODAY), [])

    def test_failed_and_wrong_shape_not_counted(self):
        items = [item("jt-20261103", "2026-11-03T13:00+09:00", "실패"),
                 item("r2-ai-20261104", "2026-11-04T07:30+09:00")] + FULL[1:3]
        gaps = sc.missing(items, TODAY)
        self.assertTrue(any("재테크" in g for g in gaps) and any("AI 영상 만들기" in g for g in gaps))

    def test_ai_video_series_id_counts(self):
        # 11/12: ai-video-03이 11/13 09:30에 예약돼 있었는데 0/1로 경보가 갔다.
        items = [FULL[0], item("ai-video-03", "2026-11-04T09:30+09:00"), FULL[3]]
        self.assertEqual(sc.missing(items, TODAY), [])

    def test_transition_uses_blog_not_daily_ai_video_quota(self):
        rows = [dict(item("ai-20261127-am", "2026-11-27T09:30+09:00"), topic_key="ai-tip-connectors-sheet")]
        gaps = sc.missing(rows, date(2026,11,26))
        text = sc.message(gaps, date(2026,11,26))
        self.assertIn("월세 공제", text)
        self.assertIn("공통소재와 다름", text)
        self.assertNotIn("다시 돌리기", text)
        self.assertNotIn("빈자리 채워줘", text)
        self.assertIn("전송결과 미확인", text)

    def test_ready_draft_does_not_become_scheduled(self):
        row = dict(item("rent", "2026-11-27T13:00+09:00", "검수 대기"),
                   editorial_slot="2026-11-27-base", topic_key="yearend-monthly-rent")
        self.assertIn("예약 아님", '\n'.join(sc.missing([row],date(2026,11,26))))

    def test_publication_requires_evidence_and_duplicate_detected(self):
        row = dict(item("rent", "2026-11-27T13:00+09:00", "올림"),
                   editorial_slot="2026-11-27-base", topic_key="yearend-monthly-rent")
        self.assertIn("증거 미확인", '\n'.join(sc.missing([row],date(2026,11,26))))
        self.assertIn("중복 큐", '\n'.join(sc.missing([row,row],date(2026,11,26))))

    def test_weekly_slots_and_calendar_absence(self):
        text = '\n'.join(sc.missing([],date(2026,11,29)))
        self.assertIn("사진 한 장", text)
        self.assertNotIn("free-course-series", text)
        self.assertIn("편성표 없음", '\n'.join(sc.missing([],date(2027,1,30))))

    def test_send_needs_secrets(self):
        sent = []
        with unittest.mock.patch.dict(sc.os.environ, {}, clear=True):
            self.assertFalse(sc.send("x", lambda *a: sent.append(a)))
        with unittest.mock.patch.dict(sc.os.environ, {"HEEYA_TELEGRAM_TOKEN": "t", "HEEYA_TELEGRAM_CHAT_ID": "1"}):
            self.assertTrue(sc.send("x", lambda *a: sent.append(a)))
        self.assertEqual(sent[0][2], {"chat_id": "1", "text": "x"})


if __name__ == "__main__":
    unittest.main()
