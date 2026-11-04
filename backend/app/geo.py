import os
import time

import requests

from app import config  # noqa: F401  (.env 로드용)

KAKAO_BASE = "https://dapi.kakao.com/v2/local"
OK_TTL = 24 * 3600   # 지명을 찾았으면 하루 동안 기억
FAIL_TTL = 60        # 실패하면 1분 동안은 다시 묻지 않음 (카카오 장애 때 응답이 느려지는 것 방지)
MAX_CACHE = 2000

_cache: dict[tuple[float, float], tuple[str | None, float]] = {}


def _kakao_get(path: str, params: dict) -> dict | None:
    key = os.getenv("KAKAO_REST_API_KEY")
    if not key:
        return None
    try:
        res = requests.get(
            f"{KAKAO_BASE}/{path}",
            params=params,
            headers={"Authorization": f"KakaoAK {key}"},
            timeout=2,
        )
        res.raise_for_status()
        return res.json()
    except requests.RequestException:
        return None


def _lookup(lat: float, lng: float) -> str | None:
    # 1) 1km 안의 가장 가까운 지하철역
    data = _kakao_get(
        "search/category.json",
        {
            "category_group_code": "SW8",
            "x": lng,
            "y": lat,
            "radius": 1000,
            "sort": "distance",
            "size": 1,
        },
    )
    if data and data.get("documents"):
        station = data["documents"][0]["place_name"].split()[0]
        return f"{station} 근처"

    # 2) 없으면 행정구역 (예: 마포구 서교동)
    data = _kakao_get("geo/coord2regioncode.json", {"x": lng, "y": lat})
    if data and data.get("documents"):
        docs = data["documents"]
        region = next((d for d in docs if d.get("region_type") == "H"), docs[0])
        name = " ".join(
            p
            for p in (region.get("region_2depth_name"), region.get("region_3depth_name"))
            if p
        )
        return name or None
    return None


def area_name(lat: float, lng: float) -> str | None:
    """500m 격자 중심 좌표 주변의 지명. 못 찾으면 None."""
    key = (round(lat, 5), round(lng, 5))
    hit = _cache.get(key)
    if hit and hit[1] > time.time():
        return hit[0]

    result = _lookup(lat, lng)
    if len(_cache) >= MAX_CACHE:
        _cache.clear()
    _cache[key] = (result, time.time() + (OK_TTL if result else FAIL_TTL))
    return result