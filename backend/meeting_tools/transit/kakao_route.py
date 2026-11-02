import os
import logging
from pathlib import Path

import requests
from dotenv import load_dotenv


# backend/.env 읽기. 이미 설정된 환경변수는 덮어쓰지 않음
BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env")


logger = logging.getLogger("meetmap.transit")


class TransitError(Exception):
    """화면에 전달할 수 있는 교통 조회 오류"""
    def __init__(self, message: str, code: str = "TRANSIT_ERROR"):
        super().__init__(message)
        self.code = code


def _failure(message: str, code: str, http_status: int | None = None):
    # 예외 원문·URL·헤더·좌표·응답 본문은 로그에 남기지 않는다.
    logger.warning("[교통 조회 실패] code=%s http_status=%s", code, http_status)
    return TransitError(message, code)


def fetch_kakao_routes(start: dict, end: dict) -> list:
    """
    start, end 형식:
    {"x": 경도, "y": 위도}
    """

    api_key = os.getenv("KAKAO_REST_API_KEY")

    if not api_key:
        raise _failure("서버에 카카오 REST API 키가 설정되지 않았습니다.", "NOT_CONFIGURED")

    try:
        response = requests.get(
            "https://dapi.kakao.com/v2/routing/publictraffic",
            headers={
                "Authorization": f"KakaoAK {api_key}"
            },
            params={
                "start_x": start["x"],
                "start_y": start["y"],
                "end_x": end["x"],
                "end_y": end["y"],
            },
            timeout=15,
        )
        response.raise_for_status()

    except requests.exceptions.Timeout:
        raise _failure("교통 조회 시간이 초과되었습니다. 다시 시도해 주세요.", "TIMEOUT") from None
    except requests.exceptions.HTTPError as error:
        status = error.response.status_code if error.response is not None else None
        if status in (401, 403):
            raise _failure("카카오 대중교통 API의 인증키 또는 사용 권한을 확인해 주세요.", "AUTH_FAILED", status) from None
        if status == 429:
            raise _failure("교통 API 호출 한도를 초과했어요. 잠시 후 다시 시도해 주세요.", "RATE_LIMITED", status) from None
        if status == 404:
            raise _failure("대중교통 API 요청 주소 또는 제공 상태를 확인해 주세요.", "ENDPOINT_NOT_FOUND", status) from None
        raise _failure("교통 API 서버가 요청에 오류를 반환했어요.", "HTTP_ERROR", status) from None
    except requests.exceptions.RequestException:
        raise _failure("교통 API 서버에 연결하지 못했어요.", "NETWORK_ERROR") from None

    try:
        data = response.json()
    except ValueError:
        raise _failure("교통 API 응답을 해석할 수 없습니다.", "BAD_RESPONSE") from None

    if not isinstance(data, dict):
        raise _failure("교통 API 응답 형식이 올바르지 않습니다.", "BAD_RESPONSE")

    if data.get("status") != "OK":
        raise _failure("대중교통 API가 경로 조회 성공 응답을 반환하지 않았어요.", "PROVIDER_NOT_OK")

    routes = data.get("routes")

    if not isinstance(routes, list) or not routes:
        raise _failure("조회 가능한 대중교통 경로가 없습니다.", "NO_ROUTE")

    return routes


def get_fastest_seconds(routes: list) -> float:
    """정상적인 경로 중 가장 짧은 이동시간을 초 단위로 반환"""

    times = []

    for route in routes:
        if not isinstance(route, dict):
            continue

        properties = route.get("properties")

        if not isinstance(properties, dict):
            continue

        seconds = properties.get("totalTime")

        if (
            isinstance(seconds, (int, float))
            and not isinstance(seconds, bool)
            and seconds >= 0
        ):
            times.append(float(seconds))

    if not times:
        raise _failure("경로의 이동시간 정보가 없습니다.", "NO_TIME")

    return min(times)