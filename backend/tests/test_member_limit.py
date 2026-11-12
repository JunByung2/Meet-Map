"""출발지(참여 인원) 제한 해제 검증. 외부 API나 실제 DB에 접속하지 않는다.
backend에서 python tests/test_member_limit.py
"""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pydantic import ValidationError
from meeting_tools import api as tools_api
from meeting_tools.recommendation import recommend_service as service


def points(n):
    return [{"x": 126.9 + i * 0.01, "y": 37.5} for i in range(n)]


class StopHere(Exception):
    pass


class MemberLimitTests(unittest.TestCase):
    def reaches_search(self, n):
        """인원 검사를 통과해 후보 검색 단계까지 가는지"""
        with patch.object(service, "search_candidates", side_effect=StopHere):
            try:
                service.recommend_places(points(n))
            except StopHere:
                return True
            except service.RecommendationError as error:
                self.assertEqual(error.code, "INVALID_DEPARTURES")
                return False
        return True

    def test_five_or_fewer_still_work(self):
        for n in (2, 3, 5):
            self.assertTrue(self.reaches_search(n), n)

    def test_more_than_five_is_allowed(self):
        for n in (6, 8, 12, 30, service.MAX_DEPARTURES):
            self.assertTrue(self.reaches_search(n), n)

    def test_fewer_than_two_is_rejected(self):
        for n in (0, 1):
            self.assertFalse(self.reaches_search(n), n)

    def test_safety_cap_is_far_above_normal_groups(self):
        self.assertGreaterEqual(service.MAX_DEPARTURES, 30)
        self.assertFalse(self.reaches_search(service.MAX_DEPARTURES + 1))

    def test_request_model_accepts_many(self):
        ok = tools_api.RecommendRequest(departures=[tools_api.Location(**p) for p in points(9)])
        self.assertEqual(len(ok.departures), 9)
        with self.assertRaises(ValidationError):
            tools_api.RecommendRequest(departures=[tools_api.Location(**points(1)[0])])


if __name__ == "__main__":
    unittest.main()