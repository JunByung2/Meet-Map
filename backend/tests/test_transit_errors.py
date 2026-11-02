"""가짜 API 응답만 사용. 실제 키·좌표·공유 DB를 사용하지 않는다."""
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from meeting_tools.transit import kakao_route as route
from meeting_tools.recommendation import recommend_service as service
POINT = {"x": 127.0, "y": 37.5}

class TransitErrors(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"KAKAO_REST_API_KEY": "FAKE_SECRET"})
        self.env.start()
    def tearDown(self):
        self.env.stop()
    def test_http_errors_are_distinct_and_do_not_log_secrets(self):
        for status, code in [(401,"AUTH_FAILED"),(403,"AUTH_FAILED"),(429,"RATE_LIMITED"),(404,"ENDPOINT_NOT_FOUND"),(500,"HTTP_ERROR")]:
            with self.subTest(status=status):
                response=Mock(status_code=status)
                response.raise_for_status.side_effect=route.requests.exceptions.HTTPError("FAKE_SECRET URL",response=response)
                with patch.object(route.requests,"get",return_value=response),self.assertLogs(route.logger,level="WARNING") as logs:
                    with self.assertRaises(route.TransitError) as e:route.fetch_kakao_routes(POINT,POINT)
                self.assertEqual(e.exception.code,code)
                self.assertNotIn("FAKE_SECRET",str(e.exception)+str(logs.output))
    def test_transport_failures_are_distinct(self):
        for exc,code in [(route.requests.exceptions.Timeout("SECRET"),"TIMEOUT"),(route.requests.exceptions.ConnectionError("SECRET"),"NETWORK_ERROR")]:
            with self.subTest(code=code),patch.object(route.requests,"get",side_effect=exc):
                with self.assertRaises(route.TransitError) as e:route.fetch_kakao_routes(POINT,POINT)
                self.assertEqual(e.exception.code,code)
                self.assertNotIn("SECRET",str(e.exception))
    def test_response_failures_are_distinct(self):
        for body,code in [([],"BAD_RESPONSE"),({"status":"ERROR"},"PROVIDER_NOT_OK"),({"status":"OK","routes":[]},"NO_ROUTE")]:
            with self.subTest(code=code):
                response=Mock();response.json.return_value=body
                with patch.object(route.requests,"get",return_value=response):
                    with self.assertRaises(route.TransitError) as e:route.fetch_kakao_routes(POINT,POINT)
                self.assertEqual(e.exception.code,code)
    def test_invalid_json(self):
        response=Mock();response.json.side_effect=ValueError("SECRET")
        with patch.object(route.requests,"get",return_value=response):
            with self.assertRaises(route.TransitError) as e:route.fetch_kakao_routes(POINT,POINT)
        self.assertEqual(e.exception.code,"BAD_RESPONSE")
    def test_success_keeps_original_routes(self):
        response=Mock();response.json.return_value={"status":"OK","routes":[{"properties":{"totalTime":120}}]}
        with patch.object(route.requests,"get",return_value=response):
            self.assertEqual(route.get_fastest_seconds(route.fetch_kakao_routes(POINT,POINT)),120)
    def test_missing_key_does_not_call_api(self):
        with patch.dict(os.environ,{"KAKAO_REST_API_KEY":""}),patch.object(route.requests,"get") as get:
            with self.assertRaises(route.TransitError) as e:route.fetch_kakao_routes(POINT,POINT)
        self.assertEqual(e.exception.code,"NOT_CONFIGURED");get.assert_not_called()
    def test_recommend_propagates_auth_and_rate_limit_errors(self):
        for code in ("AUTH_FAILED","RATE_LIMITED","NOT_CONFIGURED","ENDPOINT_NOT_FOUND"):
            with self.subTest(code=code),patch.object(service,"search_candidates",return_value=[{"id":"fake"}]),patch.object(service,"evaluate_candidate",side_effect=route.TransitError("safe message",code)):
                with self.assertRaises(service.RecommendationError) as e:service.recommend_places([POINT,POINT])
                self.assertEqual(e.exception.code,"TRANSIT_"+code)

if __name__=="__main__":unittest.main(verbosity=2)
