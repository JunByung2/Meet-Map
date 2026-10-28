"""외부 API나 실제 DB에 접속하지 않는 후보 검색/순위 회귀 검증."""
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from meeting_tools.recommendation import recommend_service as service

CENTER = {"x": 127.0, "y": 37.5}
DEPARTURES = [{"x": 126.9, "y": 37.5}, {"x": 127.1, "y": 37.5}]

def doc(place_id="1", name="시험역", x=127.0, y=37.5, **extra):
    return {"id": place_id, "place_name": name, "x": str(x), "y": str(y), "address_name": "테스트 장소", **extra}

def candidate(place_id="1", kind="subway"):
    return {"id": place_id, "name": "테스트 후보", "address": "테스트 장소", "x": 127.0, "y": 37.5, "candidate_type": kind}

class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"KAKAO_REST_API_KEY": "test-only"})
        self.env.start()
        self.no_network = patch.object(service.requests, "get", side_effect=AssertionError("unexpected external request"))
        self.no_network.start()
    def tearDown(self):
        self.no_network.stop()
        self.env.stop()

    def test_search_only_requests_subway_candidates(self):
        with patch.object(service, "_documents", return_value=[doc()]) as fetch:
            values = service.search_candidates(CENTER, DEPARTURES)
        self.assertTrue(values)
        self.assertTrue(all(c.args[2:4] == ("subway", None) for c in fetch.call_args_list))
        self.assertTrue(all(p["candidate_type"] == "subway" for p in values))

    def test_radius_expands_from_5_to_10_to_20(self):
        radii = []
        def fetch(point, radius, kind, query, key):
            radii.append(radius)
            return [doc(y=37.62)] if radius == 20000 and kind == "subway" else []
        with patch.object(service, "_documents", side_effect=fetch):
            self.assertEqual(len(service.search_candidates(CENTER, DEPARTURES)), 1)
        self.assertTrue({5000, 10000, 20000}.issubset(radii))
        self.assertLessEqual(max(radii), 20000)

    def test_searches_around_departures_after_empty_center(self):
        def fetch(point, radius, kind, query, key):
            if point == DEPARTURES[0] and kind == "subway":
                return [doc("station", "시험역", x=point["x"], y=point["y"])]
            return []
        with patch.object(service, "_documents", side_effect=fetch):
            values = service.search_candidates(CENTER, DEPARTURES)
        self.assertEqual(values[0]["candidate_type"], "subway")

    def test_duplicate_place_is_evaluated_once(self):
        with patch.object(service, "_documents", return_value=[doc(), doc()]):
            values = service.search_candidates(CENTER, DEPARTURES)
        self.assertEqual(len(values), 1)

    def test_line_specific_places_of_same_station_are_merged(self):
        documents = [doc("gyeongui", "풍산역 경의중앙선"),
                     doc("seohae", "풍산역 서해선", x=127.0003),
                     doc("other", "다른역 경의중앙선", x=127.001)]
        with patch.object(service, "_documents", return_value=documents):
            values = service.search_candidates(CENTER, DEPARTURES)
        self.assertEqual(len(values), 2)
        self.assertEqual(sum(service._station_name(p["name"]) == "풍산역" for p in values), 1)

    def test_same_station_name_in_other_region_is_preserved(self):
        documents = [doc("near", "중앙역 4호선"), doc("far", "중앙역 다른노선", x=127.02)]
        with patch.object(service, "_documents", return_value=documents):
            self.assertEqual(len(service.search_candidates(CENTER, DEPARTURES)), 2)

    def test_nearby_stations_with_different_names_are_preserved(self):
        self.assertFalse(service._same_station(
            {**candidate("a"), "name": "풍산역 경의중앙선"},
            {**candidate("b"), "name": "백마역 경의중앙선"}))

    def test_station_named_cafe_is_not_bus_stop(self):
        self.assertIsNone(service._candidate(doc(name="버스정류장 카페", category_group_code="CE7"), "bus_stop", CENTER, 5000))

    def test_parking_lot_is_not_terminal(self):
        self.assertIsNone(service._candidate(doc(name="시험 버스터미널 주차장"), "terminal", CENTER, 5000))

    def test_invalid_coordinate_is_ignored(self):
        self.assertIsNone(service._candidate(doc(x="NaN"), "subway", CENTER, 5000))

    def test_outside_radius_is_ignored(self):
        self.assertIsNone(service._candidate(doc(x=129, y=35), "subway", CENTER, 5000))

    def test_empty_search_has_distinct_error(self):
        with patch.object(service, "_documents", return_value=[]):
            with self.assertRaises(service.RecommendationError) as raised:
                service.search_candidates(CENTER, DEPARTURES)
        self.assertEqual(raised.exception.code, "NO_CANDIDATES")
        self.assertEqual(raised.exception.status_code, 422)

    def test_all_search_failures_are_not_reported_as_empty(self):
        with patch.object(service, "_documents", side_effect=service.SearchUnavailable("search failed", code="SEARCH_UNAVAILABLE")):
            with self.assertRaises(service.SearchUnavailable) as raised:
                service.search_candidates(CENTER, DEPARTURES)
        self.assertEqual(raised.exception.code, "SEARCH_UNAVAILABLE")

    def test_auth_failure_stops_search_expansion(self):
        with patch.object(service, "_documents", side_effect=service.SearchUnavailable("권한 오류", code="SEARCH_AUTH_FAILED")) as fetch:
            with self.assertRaises(service.SearchUnavailable):
                service.search_candidates(CENTER, DEPARTURES)
        self.assertEqual(fetch.call_count, 1)

    def test_partial_search_failure_can_use_later_radius(self):
        def fetch(point, radius, kind, query, key):
            if radius == 5000:
                raise service.SearchUnavailable("temporary failure")
            return [doc()]
        with patch.object(service, "_documents", side_effect=fetch):
            self.assertTrue(service.search_candidates(CENTER, DEPARTURES))

    def test_candidate_cap_excludes_non_subway_sources(self):
        items = [{**candidate(str(i)), "x": 127+i*.0001} for i in range(40)]
        items += [candidate("bus", "bus_stop")]
        values = service._select(items, DEPARTURES)
        self.assertEqual(len(values), service.MAX_CANDIDATES)
        self.assertTrue(all(p["candidate_type"] == "subway" for p in values))

    def test_http_error_does_not_expose_api_key_or_raw_error(self):
        response = Mock(status_code=403)
        response.raise_for_status.side_effect = service.requests.exceptions.HTTPError("SECRET_URL_OR_KEY", response=response)
        with patch.object(service.requests, "get", return_value=response):
            with self.assertRaises(service.SearchUnavailable) as raised:
                service._documents(CENTER, 5000, "subway", None, "SECRET_KEY")
        self.assertNotIn("SECRET", str(raised.exception))
        self.assertEqual(raised.exception.code, "SEARCH_AUTH_FAILED")

    def test_keyword_request_uses_real_category_or_keyword_endpoints(self):
        response = Mock()
        response.json.return_value = {"documents": []}
        with patch.object(service.requests, "get", return_value=response) as get:
            service._documents(CENTER, 10000, "subway", None, "test-only")
        self.assertTrue(get.call_args.args[0].endswith("/category.json"))
        self.assertEqual(get.call_args.kwargs["params"]["category_group_code"], "SW8")

    def test_missing_key_is_explicit(self):
        with patch.dict(os.environ, {"KAKAO_REST_API_KEY": ""}):
            with self.assertRaises(service.SearchUnavailable) as raised:
                service.search_candidates(CENTER, DEPARTURES)
        self.assertEqual(raised.exception.code, "SEARCH_NOT_CONFIGURED")

    def test_balanced_times_win_over_departure_and_geographic_midpoint(self):
        items = [candidate("departure"), {**candidate("balanced"), "x": 127.01}]
        def routes(start, end):
            seconds = ([0, 3570] if end["id"] == "departure" else [1800, 2100])[DEPARTURES.index(start)]
            return [{"properties": {"totalTime": seconds}}]
        with patch.object(service, "search_candidates", return_value=items), patch.object(service, "fetch_kakao_routes", side_effect=routes):
            result = service.recommend_places(DEPARTURES)
        self.assertEqual(result["recommendations"][0]["id"], "balanced")
        self.assertEqual(result["recommendations"][0]["member_minutes"], [30.0, 35.0])
        self.assertEqual(result["recommendations"][0]["time_gap_minutes"], 5)

    def test_requested_station_order_prefers_shorter_maximum(self):
        times = {"gupabal": [2352, 2424], "samsong": [1962, 2076], "jichuk": [2142, 2316]}
        def routes(start, end):
            return [{"properties": {"totalTime": times[end["id"]][DEPARTURES.index(start)]}}]
        with patch.object(service, "search_candidates", return_value=[candidate(k) for k in times]), patch.object(service, "fetch_kakao_routes", side_effect=routes):
            result = service.recommend_places(DEPARTURES)
        self.assertEqual([p["id"] for p in result["recommendations"]], ["samsong", "jichuk", "gupabal"])

    def test_equal_maximum_prefers_smaller_time_gap(self):
        times = {"unequal": [600, 2100], "balanced": [1800, 2100]}
        def routes(start, end):
            return [{"properties": {"totalTime": times[end["id"]][DEPARTURES.index(start)]}}]
        with patch.object(service, "search_candidates", return_value=[candidate(k) for k in times]), patch.object(service, "fetch_kakao_routes", side_effect=routes):
            result = service.recommend_places(DEPARTURES)
        self.assertEqual(result["recommendations"][0]["id"], "balanced")

    def test_three_members_use_full_time_range(self):
        starts = DEPARTURES + [{"x": 127.2, "y": 37.5}]
        def routes(start, end):
            seconds = ([600, 1200, 3600] if end["id"] == "unequal" else [1800, 2100, 2400])[starts.index(start)]
            return [{"properties": {"totalTime": seconds}}]
        with patch.object(service, "search_candidates", return_value=[candidate("unequal"), candidate("balanced")]), patch.object(service, "fetch_kakao_routes", side_effect=routes):
            result = service.recommend_places(starts)
        self.assertEqual(result["recommendations"][0]["id"], "balanced")
        self.assertEqual(result["recommendations"][0]["time_gap_minutes"], 10)

    def test_candidate_selection_uses_midpoint_distance(self):
        # 비대칭의 세 출발지에서도 평균+최대 거리 점수가 아닌 중간지점 거리를 사용한다.
        starts = [{"x": 126.9, "y": 37.5}, {"x": 126.9, "y": 37.5}, {"x": 127.2, "y": 37.5}]
        items = [{**candidate("center"), "x": 127.0}, {**candidate("other"), "x": 127.03}]
        self.assertEqual(service._select(items, starts)[0]["id"], "center")

    def test_candidate_with_one_unreachable_member_is_excluded(self):
        def evaluate(item, departures):
            if item["id"] == "bad":
                raise service.TransitError("member route missing")
            return {"id": "ok", "name": "ok", "address": "", "latitude": 37.5, "longitude": 127,
                    "score_seconds": 90, "maximum_seconds": 120, "average_seconds": 60, "member_seconds": [0, 120]}
        with patch.object(service, "search_candidates", return_value=[candidate("bad"), candidate("ok")]), patch.object(service, "evaluate_candidate", side_effect=evaluate):
            result = service.recommend_places(DEPARTURES)
        self.assertEqual(result["excluded_count"], 1)
        self.assertEqual(result["recommendations"][0]["id"], "ok")

    def test_all_routes_fail_has_distinct_error(self):
        with patch.object(service, "search_candidates", return_value=[candidate()]), patch.object(service, "evaluate_candidate", side_effect=service.TransitError("no route")):
            with self.assertRaises(service.RecommendationError) as raised:
                service.recommend_places(DEPARTURES)
        self.assertEqual(raised.exception.code, "NO_REACHABLE_CANDIDATES")

    def test_same_location_uses_zero_without_network(self):
        with patch.object(service, "fetch_kakao_routes") as fetch:
            result = service.evaluate_candidate(candidate(), [CENTER, CENTER])
        fetch.assert_not_called()
        self.assertEqual(result["member_seconds"], [0, 0])

    def test_nonfinite_route_time_rejected(self):
        with patch.object(service, "fetch_kakao_routes", return_value=[]), patch.object(service, "get_fastest_seconds", return_value=float("nan")):
            with self.assertRaises(service.TransitError):
                service.evaluate_candidate(candidate(), DEPARTURES)

    def test_invalid_departures_fail_before_search(self):
        for values in ([CENTER], [{"x": float("nan"), "y": 37}, CENTER]):
            with self.subTest(values=values), patch.object(service, "search_candidates") as search:
                with self.assertRaises(service.RecommendationError):
                    service.recommend_places(values)
                search.assert_not_called()

if __name__ == "__main__":
    unittest.main(verbosity=2)
