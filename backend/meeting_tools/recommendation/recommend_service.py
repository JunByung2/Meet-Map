import os
from concurrent.futures import ThreadPoolExecutor

import requests

from meeting_tools.transit.kakao_route import (
    TransitError,
    fetch_kakao_routes,
    get_fastest_seconds,
)


def search_candidates(center: dict) -> list:
    """중심 주변의 역을 자동 검색"""

    api_key = os.getenv("KAKAO_REST_API_KEY")

    if not api_key:
        raise TransitError("카카오 REST API 키가 설정되지 않았습니다.")

    try:
        response = requests.get(
            "https://dapi.kakao.com/v2/local/search/category.json",
            headers={"Authorization": f"KakaoAK {api_key}"},
            params={
                "category_group_code": "SW8",
                "x": center["x"],
                "y": center["y"],
                "radius": 5000,
                "sort": "distance",
                "size": 8,
            },
            timeout=15,
        )
        response.raise_for_status()
        data = response.json()

    except (requests.exceptions.RequestException, ValueError):
        raise TransitError(
            "후보 역 검색에 실패했습니다. 키와 API 사용 설정을 확인해 주세요."
        ) from None

    documents = data.get("documents") if isinstance(data, dict) else None

    if not isinstance(documents, list):
        raise TransitError("후보 검색 응답 형식이 올바르지 않습니다.")

    candidates = []
    seen = set()

    for place in documents:
        try:
            place_id = str(place["id"])

            if place_id in seen:
                continue

            candidate = {
                "id": place_id,
                "name": place["place_name"],
                "address": (
                    place.get("road_address_name")
                    or place.get("address_name", "")
                ),
                "x": float(place["x"]),
                "y": float(place["y"]),
            }

        except (KeyError, TypeError, ValueError):
            continue

        seen.add(place_id)
        candidates.append(candidate)

    return candidates


def evaluate_candidate(candidate: dict, departures: list) -> dict:
    """모든 참여자의 후보 장소까지 이동시간 계산"""

    travel_times = []

    for departure in departures:
        # 사실상 같은 좌표라면 이동시간 0
        same_location = (
            abs(departure["x"] - candidate["x"]) < 0.000001
            and abs(departure["y"] - candidate["y"]) < 0.000001
        )

        if same_location:
            seconds = 0.0
        else:
            routes = fetch_kakao_routes(departure, candidate)
            seconds = get_fastest_seconds(routes)

        travel_times.append(seconds)

    average = sum(travel_times) / len(travel_times)
    maximum = max(travel_times)

    return {
        "id": candidate["id"],
        "name": candidate["name"],
        "address": candidate["address"],
        "latitude": candidate["y"],
        "longitude": candidate["x"],
        "average_seconds": average,
        "maximum_seconds": maximum,
        "member_seconds": travel_times,
        "score_seconds": (average + maximum) / 2,
    }


def recommend_places(departures: list) -> dict:
    """중간 지점 검색 → 실제 이동시간 비교 → 상위 3곳"""

    center = {
        "x": sum(place["x"] for place in departures) / len(departures),
        "y": sum(place["y"] for place in departures) / len(departures),
    }

    candidates = search_candidates(center)

    if not candidates:
        raise TransitError(
            "중간 지점 반경 5km에 후보 역이 없습니다."
        )

    results = []
    excluded_count = 0

    # 최대 4개 후보를 동시에 평가
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [
            executor.submit(evaluate_candidate, candidate, departures)
            for candidate in candidates
        ]

        for future in futures:
            try:
                results.append(future.result())
            except TransitError:
                # 한 명이라도 경로 조회에 실패하면 해당 후보 제외
                excluded_count += 1

    if not results:
        raise TransitError(
            "모든 후보의 교통 조회에 실패했습니다. "
            "경로 제공 여부와 API 상태를 확인해 주세요."
        )

    # 표시용 반올림 전에 실제 초 단위로 정렬
    results.sort(
        key=lambda place: (
            place["score_seconds"],
            place["maximum_seconds"],
            place["average_seconds"],
            place["id"],
        )
    )

    top_places = []

    for result in results[:3]:
        top_places.append({
            **result,
            "average": round(result["average_seconds"] / 60, 1),
            "maximum": round(result["maximum_seconds"] / 60, 1),
            "member_minutes": [
                round(seconds / 60, 1)
                for seconds in result["member_seconds"]
            ],
        })

    return {
        "center": {
            "latitude": center["y"],
            "longitude": center["x"],
        },
        "candidate_count": len(candidates),
        "evaluated_count": len(results),
        "excluded_count": excluded_count,
        "ranking_rule": "평균 이동시간 50% + 최대 이동시간 50%",
        "recommendations": top_places,
    }