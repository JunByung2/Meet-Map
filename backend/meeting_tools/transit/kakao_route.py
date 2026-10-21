import os
from pathlib import Path

import requests
from dotenv import load_dotenv


# backend/.env 읽기. 이미 설정된 환경변수는 덮어쓰지 않음
BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env")


class TransitError(Exception):
    """화면에 전달할 수 있는 교통 조회 오류"""
    pass


def fetch_kakao_routes(start: dict, end: dict) -> list:
    """
    start, end 형식:
    {"x": 경도, "y": 위도}
    """

    api_key = os.getenv("KAKAO_REST_API_KEY")

    if not api_key:
        raise TransitError(
            "서버에 카카오 REST API 키가 설정되지 않았습니다."
        )

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
        raise TransitError(
            "교통 조회 시간이 초과되었습니다. 다시 시도해 주세요."
        ) from None

    except requests.exceptions.RequestException:
        raise TransitError(
            "교통 API 요청에 실패했습니다. 서버 설정을 확인해 주세요."
        ) from None

    try:
        data = response.json()
    except ValueError:
        raise TransitError(
            "교통 API 응답을 해석할 수 없습니다."
        ) from None

    if not isinstance(data, dict):
        raise TransitError("교통 API 응답 형식이 올바르지 않습니다.")

    if data.get("status") != "OK":
        raise TransitError("대중교통 경로 조회에 실패했습니다.")

    routes = data.get("routes")

    if not isinstance(routes, list) or not routes:
        raise TransitError("조회 가능한 대중교통 경로가 없습니다.")

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
        raise TransitError("경로의 이동시간 정보가 없습니다.")

    return min(times)