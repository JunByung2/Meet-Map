"""추천된 역 주변의 식당·카페·놀 곳·술집을 카카오 로컬 API로 찾는다.

- 검색 기준 좌표는 서버에 저장된 추천 결과의 역 좌표만 쓴다. (요청에서 좌표를 받지 않는다)
- 카카오 로컬 API는 평점을 주지 않으므로 역에서 가까운 순으로 보여 준다.
- 세부 필터(한식, 프랜차이즈 제외 등)는 허용 목록에 있는 값만 쓴다.
- 시간 초과나 일시적인 서버 오류는 한 번만 다시 시도한다.
- 같은 역·종류·필터는 잠깐 캐시해서 API 호출 한도를 아낀다.
"""
import logging
import math
import os
import threading
import time

import requests

from meeting_tools.recommendation.recommend_service import SearchUnavailable

logger = logging.getLogger("meetmap.recommendation")


def _parts(category_name):
    return [part.strip() for part in str(category_name or "").split(">") if part.strip()]


# 필터 조건. 장소 하나(item)를 받아 남길지 True/False 로 답한다.
def _second(*names):
    """카테고리의 두 번째 단계가 names 중 하나인 장소. 예: 음식점 > 한식 > ..."""
    def keep(item):
        parts = _parts(item["category"])
        return len(parts) > 1 and parts[1] in names
    return keep


def _not_second(*names):
    def keep(item):
        parts = _parts(item["category"])
        return not (len(parts) > 1 and parts[1] in names)
    return keep


def _has(*names):
    """카테고리 단계 중 하나라도 names 에 있는 장소."""
    def keep(item):
        parts = _parts(item["category"])
        return any(name in parts for name in names)
    return keep


def _independent(item):
    """프랜차이즈가 아닌 카페.
    프랜차이즈는 분류 끝에 브랜드명이 붙고 그 이름이 가게 이름에도 들어 있다.
    예: 음식점 > 카페 > 커피전문점 > 스타벅스, 음식점 > 카페 > 공차
    (북카페·디저트카페처럼 종류를 뜻하는 끝 단계는 브랜드로 보지 않는다)"""
    parts = _parts(item["category"])
    if len(parts) < 3:
        return True
    last = parts[-1]
    if last == "커피전문점" or last.endswith("카페"):
        return True
    return last not in item["name"]


def _mentions(*words):
    """가게 이름이나 분류에 words 중 하나가 들어 있는 장소. 키워드 검색이 느슨하게 맞춘 결과를 거른다."""
    def keep(item):
        text = f"{item['category']} {item['name']}"
        return any(word in text for word in words)
    return keep


# 종류 -> (화면 이름, 카카오 카테고리 코드, {필터: (화면 이름, 키워드, 결과 걸러내기)})
# 첫 번째 필터가 기본값이다. 키워드가 없으면 카테고리 검색, 있으면 키워드 검색을 한다.
CATEGORIES = {
    "restaurant": ("식당", "FD6", {
        "all": ("전체", None, _not_second("간식", "카페", "술집")),
        "korean": ("한식", "한식", _second("한식")),
        "japanese": ("일식", "일식", _second("일식")),
        "western": ("양식", "양식", _second("양식")),
        "chinese": ("중식", "중식", _second("중식")),
        "snack": ("분식", "분식", _second("분식")),
        "meat": ("고기", "고기", _has("육류,고기")),
    }),
    "cafe": ("카페", "CE7", {
        "all": ("전체", None, None),
        "independent": ("프랜차이즈 제외", None, _independent),
        "dessert": ("디저트", "디저트", _has("디저트카페", "제과,베이커리")),
        "theme": ("테마카페", "테마카페", _has("테마카페")),
    }),
    "play": ("놀 곳", None, {
        "boardgame": ("보드게임", "보드게임카페", _mentions("보드게임", "보드카페", "보드 카페")),
        "escape": ("방탈출", "방탈출", _mentions("방탈출", "이스케이프", "탈출")),
        "karaoke": ("노래방", "노래방", _mentions("노래방", "노래연습장", "코인노래")),
        "bowling": ("볼링", "볼링장", _mentions("볼링")),
        "billiards": ("당구", "당구장", _mentions("당구", "포켓볼", "스누커")),
        "arcade": ("오락실", "오락실", _mentions("오락실", "아케이드", "게임장", "레트로게임")),
    }),
    "bar": ("술집", "FD6", {
        "all": ("전체", "술집", None),
    }),
}
RADIUS_METERS = 600
RAW_SIZE = 15        # 카카오가 한 번에 주는 최대 개수
MAX_RAW_PAGES = 3    # 카카오는 한 검색에서 최대 45건까지만 돌려준다
PAGE_SIZE = 10       # 화면에 한 번에 보여 줄 개수
MAX_PAGE = 3         # 더 보기로 볼 수 있는 최대 쪽수
CACHE_SECONDS = 600
CACHE_MAX_ENTRIES = 200
RETRY_DELAY = 0.3                        # 다시 시도하기 전에 잠깐 기다리는 시간(초)
RETRY_STATUSES = (500, 502, 503, 504)    # 일시적일 수 있는 서버 오류

_cache = {}
_cache_lock = threading.Lock()


def default_option(category):
    return next(iter(CATEGORIES[category][2]))


def _safe_place_url(value):
    """카카오맵 장소 페이지 주소만 링크로 허용한다. (그 외 주소는 버린다)"""
    if not isinstance(value, str):
        return None
    for prefix in ("https://place.map.kakao.com/", "http://place.map.kakao.com/"):
        if value.startswith(prefix) and len(value) > len(prefix):
            return "https://place.map.kakao.com/" + value[len(prefix):]
    return None


def _place(doc):
    if not isinstance(doc, dict):
        return None
    try:
        place_id, name = str(doc["id"]).strip(), doc["place_name"].strip()
        x, y = float(doc["x"]), float(doc["y"])
    except (KeyError, TypeError, ValueError, AttributeError):
        return None
    if not place_id or not name or not math.isfinite(x) or not math.isfinite(y):
        return None
    if not (-180 <= x <= 180 and -90 <= y <= 90):
        return None
    try:
        distance = int(float(doc.get("distance")))
    except (TypeError, ValueError):
        distance = None
    category = str(doc.get("category_name") or "")
    parts = _parts(category)
    return {
        "id": place_id,
        "name": name,
        "category": category,
        "category_short": parts[-1] if parts else "",
        "address": doc.get("road_address_name") or doc.get("address_name") or "",
        "phone": str(doc.get("phone") or ""),
        "url": _safe_place_url(doc.get("place_url")),
        "latitude": y,
        "longitude": x,
        "distance_meters": distance,
    }


def _request(x, y, code, query, page):
    key = os.getenv("KAKAO_REST_API_KEY", "").strip()
    if not key:
        raise SearchUnavailable("카카오 REST API 키가 설정되지 않았습니다.", code="SEARCH_NOT_CONFIGURED")
    params = {"x": x, "y": y, "radius": RADIUS_METERS, "size": RAW_SIZE, "page": page, "sort": "distance"}
    if code:
        params["category_group_code"] = code
    endpoint = "category"
    if query:
        endpoint, params["query"] = "keyword", query

    data = None
    for attempt in range(2):  # 처음 한 번 + 일시 오류일 때 다시 한 번
        try:
            response = requests.get(f"https://dapi.kakao.com/v2/local/search/{endpoint}.json",
                headers={"Authorization": f"KakaoAK {key}"}, params=params, timeout=(3, 8))
            response.raise_for_status()
            data = response.json()
            break
        except requests.exceptions.HTTPError as error:
            status = error.response.status_code if error.response is not None else None
            if status in RETRY_STATUSES and attempt == 0:
                time.sleep(RETRY_DELAY)
                continue
            logger.warning("주변 장소 검색 HTTP 오류: status=%s code=%s", status, code)
            if status in (401, 403):
                raise SearchUnavailable("장소 검색 권한을 확인해 주세요.", code="SEARCH_AUTH_FAILED") from None
            if status == 429:
                raise SearchUnavailable("장소 검색 요청 한도를 초과했어요. 잠시 후 다시 시도해 주세요.", code="SEARCH_RATE_LIMITED") from None
            raise SearchUnavailable("장소 검색 서버에 연결하지 못했어요.", code="SEARCH_UNAVAILABLE") from None
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError):
            if attempt == 0:
                time.sleep(RETRY_DELAY)
                continue
            raise SearchUnavailable("장소 검색이 지연되거나 응답하지 않았어요. 다시 시도해 주세요.", code="SEARCH_UNAVAILABLE") from None
        except (requests.exceptions.RequestException, ValueError):
            raise SearchUnavailable("장소 검색이 지연되거나 응답하지 않았어요. 다시 시도해 주세요.", code="SEARCH_UNAVAILABLE") from None
    if not isinstance(data, dict) or not isinstance(data.get("documents"), list):
        raise SearchUnavailable("장소 검색 응답을 확인하지 못했어요.", code="SEARCH_BAD_RESPONSE")
    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    return data["documents"], bool(meta.get("is_end", True))


def _collect(x, y, code, query, keep):
    """카카오 검색 결과를 가까운 순으로 모아 필터를 적용한다. 화면 3쪽 분량까지만 모은다."""
    wanted = PAGE_SIZE * MAX_PAGE
    items, seen = [], set()
    for raw_page in range(1, MAX_RAW_PAGES + 1):
        documents, is_end = _request(x, y, code, query, raw_page)
        for doc in documents:
            item = _place(doc)
            if item is None or item["id"] in seen:
                continue
            if keep is not None and not keep(item):
                continue
            seen.add(item["id"])
            items.append(item)
        if is_end or len(items) >= wanted:
            break
    return items[:wanted]


def search_nearby_places(longitude, latitude, category, option=None, page=1):
    """역 좌표 주변의 장소를 가까운 순으로 돌려준다."""
    if category not in CATEGORIES:
        raise ValueError("지원하지 않는 장소 종류입니다.")
    label, code, options = CATEGORIES[category]
    option = option or default_option(category)
    if option not in options:
        raise ValueError("지원하지 않는 필터입니다.")
    option_label, query, keep = options[option]
    page = min(max(int(page), 1), MAX_PAGE)

    cache_key = (round(longitude, 5), round(latitude, 5), category, option)
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(cache_key)
        items = hit[1] if hit and hit[0] > now else None

    if items is None:
        items = _collect(longitude, latitude, code, query, keep)
        with _cache_lock:
            if len(_cache) >= CACHE_MAX_ENTRIES:
                for stale in [k for k, v in _cache.items() if v[0] <= now] or [next(iter(_cache))]:
                    _cache.pop(stale, None)
            _cache[cache_key] = (now + CACHE_SECONDS, items)

    start = (page - 1) * PAGE_SIZE
    return {"category": category, "label": label, "option": option, "option_label": option_label,
            "radius_meters": RADIUS_METERS, "page": page,
            "has_more": len(items) > start + PAGE_SIZE and page < MAX_PAGE,
            "places": items[start:start + PAGE_SIZE]}