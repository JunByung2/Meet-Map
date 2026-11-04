"""실제 API 호출 없이 TAGO 응답·인증 오류·추천 연결을 검증한다."""
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from meeting_tools.transit import tago_bus as tago
from meeting_tools.recommendation import recommend_service as service


def response(items=None, code="00", total=None):
    if items is None:
        items = []
    fake = Mock()
    fake.json.return_value = {"response": {"header": {"resultCode": code}, "body": {
        "items": {"item": items}, "totalCount": len(items) if total is None else total}}}
    return fake


def stop(node="n1", city="25", name="시험 정류장"):
    return {"nodeid": node, "citycode": city, "nodenm": name, "gpslati": 36.3001, "gpslong": 127.3001}


class TagoTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"TAGO_BUS_SERVICE_KEY": "local-test-key", "KAKAO_REST_API_KEY": "local-kakao-test"})
        self.env.start()
        tago._cache.clear()
        self.network = patch.object(tago.requests, "get", side_effect=AssertionError("unexpected real HTTP request"))
        self.network.start()
    def tearDown(self):
        self.network.stop()
        self.env.stop()
        tago._cache.clear()

    def test_station_list(self):
        with patch.object(tago.requests, "get", return_value=response([stop()])):
            result = tago.fetch_nearby(36.3, 127.3)
        self.assertEqual(result["stations"][0]["id"], "tago:25:n1")
        self.assertEqual(result["radius_m"], 500)

    def test_single_item_object(self):
        fake = response()
        fake.json.return_value["response"]["body"]["items"]["item"] = stop()
        with patch.object(tago.requests, "get", return_value=fake):
            self.assertEqual(tago.fetch_nearby(36.3, 127.3)["count"], 1)

    def test_empty_items_string(self):
        fake = response()
        fake.json.return_value["response"]["body"]["items"] = ""
        with patch.object(tago.requests, "get", return_value=fake):
            self.assertEqual(tago.fetch_nearby(36.3, 127.3)["count"], 0)

    def test_city_list(self):
        with patch.object(tago.requests, "get", return_value=response([{"citycode": 25, "cityname": "대전광역시"}])) as get:
            result = tago.fetch_cities()
        self.assertEqual(result["cities"][0]["city_code"], "25")
        self.assertTrue(get.call_args.args[0].endswith("/getCtyCodeList"))

    def test_duplicate_id_keeps_distinct_city(self):
        with patch.object(tago.requests, "get", return_value=response([stop(), stop(), stop(city="26")])):
            self.assertEqual(tago.fetch_nearby(36.3, 127.3)["count"], 2)

    def test_invalid_station_coordinate_is_skipped(self):
        with patch.object(tago.requests, "get", return_value=response([{**stop(), "gpslati": "NaN"}])):
            self.assertEqual(tago.fetch_nearby(36.3, 127.3)["count"], 0)

    def test_invalid_query_is_rejected_without_http(self):
        for latitude in (91, float("nan"), True):
            with self.subTest(latitude=latitude), self.assertRaises(tago.TagoError):
                tago.fetch_nearby(latitude, 127.3)

    def test_missing_key_is_explicit(self):
        with patch.dict(os.environ, {"TAGO_BUS_SERVICE_KEY": ""}), self.assertRaises(tago.TagoError) as raised:
            tago.fetch_cities()
        self.assertEqual(raised.exception.code, "NOT_CONFIGURED")

    def test_decoding_key_sent_once_through_params(self):
        with patch.dict(os.environ, {"TAGO_BUS_SERVICE_KEY": "a%2Bb%3D"}), patch.object(tago.requests, "get", return_value=response()) as get:
            tago.fetch_nearby(36.3, 127.3)
        params = get.call_args.kwargs["params"]
        self.assertEqual(params["serviceKey"], "a+b=")
        self.assertEqual(params["gpsLati"], 36.3)
        self.assertEqual(params["gpsLong"], 127.3)
        self.assertEqual(params["_type"], "json")
        self.assertNotIn("radius", params)

    def test_success_response_is_cached(self):
        with patch.object(tago.requests, "get", return_value=response([stop()])) as get:
            first = tago.fetch_nearby(36.3, 127.3)
            first["stations"].clear()
            second = tago.fetch_nearby(36.3, 127.3)
        self.assertEqual(get.call_count, 1)
        self.assertEqual(second["count"], 1)
        self.assertEqual(len(second["stations"]), 1)

    def test_key_change_invalidates_cache(self):
        with patch.object(tago.requests, "get", return_value=response()) as get:
            tago.fetch_nearby(36.3, 127.3)
            with patch.dict(os.environ, {"TAGO_BUS_SERVICE_KEY": "different-test-key"}):
                tago.fetch_nearby(36.3, 127.3)
        self.assertEqual(get.call_count, 2)

    def test_partial_page_is_identified(self):
        with patch.object(tago.requests, "get", return_value=response([stop()], total=101)):
            self.assertTrue(tago.fetch_nearby(36.3, 127.3)["truncated"])

    def test_xml_auth_error_does_not_expose_raw_response(self):
        fake = Mock()
        fake.json.side_effect = ValueError()
        fake.text = '<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode><returnAuthMsg>SECRET</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>'
        with patch.object(tago.requests, "get", return_value=fake), self.assertRaises(tago.TagoError) as raised:
            tago.fetch_cities()
        self.assertEqual(raised.exception.code, "AUTH_FAILED")
        self.assertNotIn("SECRET", str(raised.exception))

    def test_xml_station_response(self):
        fake = Mock()
        fake.json.side_effect = ValueError()
        fake.text = '<response><header><resultCode>00</resultCode></header><body><items><item><nodeid>n1</nodeid><citycode>25</citycode><nodenm>시험</nodenm><gpslati>36.3</gpslati><gpslong>127.3</gpslong></item></items><totalCount>1</totalCount></body></response>'
        with patch.object(tago.requests, "get", return_value=fake):
            self.assertEqual(tago.fetch_nearby(36.3, 127.3)["count"], 1)

    def test_json_rate_limit(self):
        with patch.object(tago.requests, "get", return_value=response(code="22")), self.assertRaises(tago.TagoError) as raised:
            tago.fetch_cities()
        self.assertEqual(raised.exception.code, "RATE_LIMITED")

    def test_http_error_does_not_expose_key(self):
        fake = Mock(status_code=403)
        fake.raise_for_status.side_effect = tago.requests.exceptions.HTTPError("https://example/?serviceKey=SECRET", response=fake)
        with patch.object(tago.requests, "get", return_value=fake), self.assertRaises(tago.TagoError) as raised:
            tago.fetch_cities()
        self.assertEqual(raised.exception.code, "AUTH_FAILED")
        self.assertNotIn("SECRET", str(raised.exception))

    def test_timeout_is_distinct(self):
        with patch.object(tago.requests, "get", side_effect=tago.requests.exceptions.Timeout("SECRET")), self.assertRaises(tago.TagoError) as raised:
            tago.fetch_cities()
        self.assertEqual(raised.exception.status_code, 504)
        self.assertNotIn("SECRET", str(raised.exception))

    def test_malformed_response_is_not_empty_success(self):
        fake = Mock()
        fake.json.side_effect = ValueError()
        fake.text = '<html>Unavailable</html>'
        with patch.object(tago.requests, "get", return_value=fake), self.assertRaises(tago.TagoError) as raised:
            tago.fetch_cities()
        self.assertEqual(raised.exception.code, "BAD_RESPONSE")

    def test_tago_is_converted_into_bus_candidate(self):
        with patch.object(service, "fetch_nearby", return_value={"stations": [{"id": "tago:25:n1", "name": "중앙학교", "latitude": 36.3001, "longitude": 127.3001}]}):
            docs = service._documents({"x": 127.3, "y": 36.3}, 5000, "tago_bus", None, "test")
        item = service._candidate(docs[0], "tago_bus", {"x": 127.3, "y": 36.3}, 5000)
        self.assertEqual(item["candidate_type"], "bus_stop")
        self.assertEqual(item["source"], "TAGO")

    def test_real_tago_bus_stop_named_depot_is_preserved(self):
        item = service._candidate({"id": "tago:25:n1", "place_name": "시내버스차고지", "x": 127.3, "y": 36.3, "source": "TAGO"}, "tago_bus", {"x": 127.3, "y": 36.3}, 500)
        self.assertIsNotNone(item)

    def test_bus_candidate_available_when_place_search_is_empty(self):
        def fake(point, radius, kind, query, key):
            if kind == "tago_bus":
                return [{"id": "tago:25:n1", "place_name": "중앙학교", "x": point["x"], "y": point["y"], "source": "TAGO"}]
            return []
        with patch.object(service, "_documents", side_effect=fake):
            values = service.search_candidates({"x": 127.3, "y": 36.3}, [{"x": 127.29, "y": 36.3}, {"x": 127.31, "y": 36.3}])
        self.assertEqual(values[0]["candidate_type"], "bus_stop")

    def test_tago_missing_key_does_not_break_existing_place_search(self):
        with patch.dict(os.environ, {"TAGO_BUS_SERVICE_KEY": ""}):
            self.assertEqual(service._documents({"x": 127.3, "y": 36.3}, 5000, "tago_bus", None, "test"), [])

if __name__ == "__main__":
    unittest.main(verbosity=2)
