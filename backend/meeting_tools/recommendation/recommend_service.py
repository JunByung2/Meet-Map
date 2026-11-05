"""최대 이동시간과 멤버 간 시간 차이를 함께 고려해 만남 장소를 추천한다."""
import logging
from collections import Counter
import math
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from meeting_tools.recommendation.hub_screening import shortlist, verified_seconds

import requests
from meeting_tools.transit.national_route import fetch_transit_routes, tago_enabled
from meeting_tools.transit.kakao_route import TransitError, get_fastest_seconds

logger = logging.getLogger("meetmap.recommendation")
QUERIES = (("subway", None), ("train", "기차역"), ("terminal", "버스터미널"))
RECOMMENDATION_POLICY = "hub-shortlist-v12-" + ("tago" if tago_enabled() else "tmap" if os.getenv("TMAP_APP_KEY", "").strip() else "kakao")
RADII = (5000, 10000, 20000)
MAX_CANDIDATES = 5
TARGET_CANDIDATES = 6
SEARCH_SECONDS = 35


class RecommendationError(TransitError):
    """공개해도 되는 고정 문구만 담는다."""
    def __init__(self, message, status_code=502, code="RECOMMENDATION_FAILED"):
        super().__init__(message)
        self.status_code, self.code = status_code, code


class SearchUnavailable(RecommendationError):
    pass


def distance_km(a, b):
    p, q = math.radians(a["y"]), math.radians(b["y"])
    h = math.sin((q-p)/2)**2 + math.cos(p)*math.cos(q)*math.sin(math.radians(b["x"]-a["x"])/2)**2
    return 6371 * 2 * math.asin(math.sqrt(min(1.0, max(0.0, h))))


def _documents(point, radius, kind, query, key):
    params = {"x": point["x"], "y": point["y"], "radius": radius, "size": 8, "sort": "distance"}
    if query is None:
        endpoint, params["category_group_code"] = "category", "SW8"
    else:
        endpoint, params["query"] = "keyword", query
    try:
        response = requests.get(f"https://dapi.kakao.com/v2/local/search/{endpoint}.json",
            headers={"Authorization": f"KakaoAK {key}"}, params=params, timeout=(3, 8))
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.HTTPError as error:
        status = error.response.status_code if error.response is not None else None
        logger.warning("후보 검색 HTTP 오류: status=%s kind=%s radius=%s", status, kind, radius)
        if status in (401, 403):
            raise SearchUnavailable("후보 장소 검색 권한을 확인해 주세요.", code="SEARCH_AUTH_FAILED") from None
        if status == 429:
            raise SearchUnavailable("장소 검색 요청 한도를 초과했어요. 잠시 후 다시 시도해 주세요.", code="SEARCH_RATE_LIMITED") from None
        raise SearchUnavailable("후보 장소 검색 서버에 연결하지 못했어요.", code="SEARCH_UNAVAILABLE") from None
    except (requests.exceptions.RequestException, ValueError):
        raise SearchUnavailable("후보 장소 검색이 지연되거나 응답하지 않았어요. 다시 시도해 주세요.", code="SEARCH_UNAVAILABLE") from None
    if not isinstance(data, dict) or not isinstance(data.get("documents"), list):
        raise SearchUnavailable("후보 장소 검색 응답을 확인하지 못했어요.", code="SEARCH_BAD_RESPONSE")
    return data["documents"]



def meeting_place_allowed(name):
    # 장소 검색 분류만으로는 여객 취급 여부가 보장되지 않는다.
    # 명시적으로 비여객 시설·폐업으로 표시된 장소는 추천하지 않는다.
    compact = re.sub(r"\s+", "", str(name))
    return not any(word in compact for word in (
        "신호장", "신호소", "화물역", "화물전용", "차량기지", "폐역", "폐업", "영업중지",
    ))


def ranking_key(result):
    gap = max(result["member_seconds"]) - min(result["member_seconds"])
    score = result["maximum_seconds"] + 0.5 * gap
    return (score, result["average_seconds"], result["maximum_seconds"], result["id"])


def _candidate(doc, kind, point, radius):
    if kind not in ("subway", "train", "terminal") or not isinstance(doc, dict):
        return None
    # 키워드에 역/터미널이 포함된 카페·주차장·정류장은 후보에서 제외한다.
    category = [part.strip() for part in str(doc.get("category_name", "")).split(">")]
    if kind == "subway" and doc.get("category_group_code", "SW8") != "SW8":
        return None
    if kind == "train" and ("기차역" not in category or category[-1] not in ("기차역", "KTX역", "SRT역", "KTX정차역", "SRT정차역")):
        return None
    if kind == "terminal" and category[-1] not in ("버스터미널", "고속버스터미널", "시외버스터미널", "종합버스터미널"):
        return None
    try:
        place_id, name = str(doc["id"]).strip(), doc["place_name"].strip()
        x, y = float(doc["x"]), float(doc["y"])
    except (KeyError, TypeError, ValueError, AttributeError):
        return None
    if not place_id or not name or not meeting_place_allowed(name) or not math.isfinite(x) or not math.isfinite(y) or not (-180 <= x <= 180 and -90 <= y <= 90):
        return None
    item = {"id": place_id, "name": name, "x": x, "y": y, "candidate_type": kind, "source": "Kakao",
            "address": doc.get("road_address_name") or doc.get("address_name", "")}
    return item if distance_km(point, item) <= radius/1000 + .05 else None


def _station_name(name):
    # 카카오 SW8 이름의 노선 접미사만 제거한다. 역명 자체는 유지한다.
    match = re.match(r"^(.+?역)(?:\s|$)", name.strip())
    return "".join((match.group(1) if match else name).split()).casefold()


def _same_station(a, b):
    # 같은 이름만으로 다른 지역의 동명 역을 합치지 않는다.
    if (a.get("candidate_type") == "terminal") != (b.get("candidate_type") == "terminal"):
        return False
    return _station_name(a["name"]) == _station_name(b["name"]) and distance_km(a, b) <= 0.3


def corridor(departures):
    if len(departures) < 2:
        return []
    a, b = max(((a, b) for i, a in enumerate(departures) for b in departures[i+1:]),
               key=lambda pair: distance_km(*pair))
    if distance_km(a, b) < 100:
        return []
    return [{axis: a[axis] + (b[axis] - a[axis])*fraction for axis in ("x", "y")}
            for fraction in (.5, .3, .7)]


def _select(candidates, departures):
    from meeting_tools.transit.tago_intercity import HUBS
    hubs = [{"x": x, "y": y, "mode": mode}
            for mode, entries in HUBS.items() for name, x, y, station_id in entries
            if station_id and meeting_place_allowed(name)]
    eligible = [p for p in candidates
                if p["candidate_type"] in ("subway", "train", "terminal")
                and meeting_place_allowed(p["name"])]
    return shortlist(eligible, departures, hubs, distance_km, RECOMMENDATION_POLICY,
                     limit=MAX_CANDIDATES)


def search_candidates(center: dict, departures: list | None = None) -> list:
    key = os.getenv("KAKAO_REST_API_KEY", "").strip()
    if not key:
        raise SearchUnavailable("카카오 REST API 키가 설정되지 않았습니다.", code="SEARCH_NOT_CONFIGURED")
    departures = departures or [center]
    deadline = time.monotonic() + SEARCH_SECONDS
    found, locations, searched, failures = {}, set(), set(), []
    successful = 0

    def batch(points, radius):
        nonlocal successful
        jobs = []
        for point in points:
            anchor = (round(point["x"], 6), round(point["y"], 6), radius)
            if anchor not in searched:
                searched.add(anchor)
                jobs.extend((point, radius, kind, query) for kind, query in QUERIES)
        for offset in range(0, len(jobs), 4):
            if time.monotonic() >= deadline:
                break
            subset = jobs[offset:offset+4]
            with ThreadPoolExecutor(max_workers=4) as executor:
                futures = [executor.submit(_documents, p, r, k, q, key) for p, r, k, q in subset]
                for (point, r, kind, _), future in zip(subset, futures):
                    try:
                        documents = future.result()
                        successful += 1
                    except SearchUnavailable as error:
                        failures.append(error)
                        continue
                    for doc in documents:
                        item = _candidate(doc, kind, point, r)
                        if item is None:
                            continue
                        loc = ("".join(item["name"].split()), round(item["x"], 5), round(item["y"], 5))
                        if (item["id"] not in found and loc not in locations
                            and not any(_same_station(item, existing) for existing in found.values())):
                            found[item["id"]] = item
                            locations.add(loc)
            fatal = next((e for e in failures if e.code in ("SEARCH_AUTH_FAILED", "SEARCH_RATE_LIMITED")), None)
            if fatal:
                raise fatal

    anchors = corridor(departures)
    if anchors:
        batch(anchors, 20000)
        # 중심 좌표가 산간인 경우에도 근처의 알려진 여객역을 함께 평가한다.
        from meeting_tools.transit.tago_intercity import HUBS
        for mode, entries in HUBS.items():
            for name, x, y, station_id in entries:
                if not station_id or not meeting_place_allowed(name):
                    continue
                point = {"x": x, "y": y}
                if min(distance_km(anchor, point) for anchor in anchors) > 60:
                    continue
                item = {**point, "id": "hub-" + station_id, "name": name,
                        "address": "", "source": "TAGO",
                        "candidate_type": "train" if mode == "TRAIN" else "terminal"}
                if not any(_same_station(item, existing) for existing in found.values()):
                    found[item["id"]] = item
    for radius in RADII:
        batch([center], radius)
        if len(found) >= TARGET_CANDIDATES:
            break
        if time.monotonic() >= deadline:
            break
    if len(found) < TARGET_CANDIDATES and time.monotonic() < deadline:
        for radius in (10000,):
            batch(departures, radius)
            if time.monotonic() >= deadline:
                break
    if not found:
        if failures:
            raise failures[0]
        if not successful:
            raise SearchUnavailable("후보 장소 검색이 시간 내에 끝나지 않았어요.", code="SEARCH_UNAVAILABLE")
        raise RecommendationError("중간 지역과 출발지 주변에서 지하철역·기차역·버스터미널 후보를 찾지 못했어요. 출발지를 확인해 주세요.", 422, "NO_CANDIDATES")
    return _select(list(found.values()), departures)


def evaluate_candidate(candidate: dict, departures: list) -> dict:
    times = []
    for departure in departures:
        same = abs(departure["x"]-candidate["x"]) < .000001 and abs(departure["y"]-candidate["y"]) < .000001
        seconds = 0.0 if same else verified_seconds(departure, candidate, RECOMMENDATION_POLICY,
            lambda: get_fastest_seconds(fetch_transit_routes(departure, candidate)))
        if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or seconds < 0:
            raise TransitError("경로의 이동시간 정보가 올바르지 않습니다.")
        times.append(seconds)
    average, maximum = sum(times)/len(times), max(times)
    return {"id": candidate["id"], "name": candidate["name"], "address": candidate["address"],
            "latitude": candidate["y"], "longitude": candidate["x"],
            "candidate_type": candidate.get("candidate_type", "subway"), "source": candidate.get("source", "Kakao"), "average_seconds": average,
            "maximum_seconds": maximum, "minimum_seconds": min(times),
            "time_gap_seconds": maximum-min(times), "member_seconds": times}


def recommend_places(departures: list) -> dict:
    if not 2 <= len(departures) <= 5:
        raise RecommendationError("출발지는 2~5명까지 입력해 주세요.", 422, "INVALID_DEPARTURES")
    for p in departures:
        if not isinstance(p, dict) or any(isinstance(p.get(k), bool) or not isinstance(p.get(k), (int, float))
            or not math.isfinite(p[k]) or abs(p[k]) > bound for k, bound in (("x", 180), ("y", 90))):
            raise RecommendationError("출발지 좌표를 확인해 주세요.", 422, "INVALID_DEPARTURES")
    center = {"x": sum(p["x"] for p in departures)/len(departures), "y": sum(p["y"] for p in departures)/len(departures)}
    started = time.monotonic()
    candidates = search_candidates(center, departures)
    logger.warning("[추천] 실제 경로 검증 시작: 후보 %s개, 멤버 %s명", len(candidates), len(departures))
    results, excluded = [], 0
    failures = Counter()
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(evaluate_candidate, item, departures) for item in candidates]
        for future in futures:
            try:
                value = future.result()
                value["center_distance_meters"] = round(distance_km(center,
                    {"x": value["longitude"], "y": value["latitude"]}) * 1000, 1)
                results.append(value)
                logger.warning("[추천] 검증 완료: %s (%0.1f초)", value["name"], time.monotonic()-started)
            except TransitError as error:
                excluded += 1
                code = getattr(error, "code", "TRANSIT_ERROR")
                failures[code] += 1
                if code in ("NOT_CONFIGURED", "AUTH_FAILED", "RATE_LIMITED", "ENDPOINT_NOT_FOUND"):
                    for pending in futures:
                        pending.cancel()
                    raise RecommendationError(str(error), code=f"TRANSIT_{code}") from None
    if failures:
        logger.warning("[추천 경로 요약] excluded=%s failures=%s", excluded, dict(failures))
    if not results:
        raise RecommendationError("후보 장소는 찾았지만 전원의 대중교통 이동시간을 확인하지 못했어요. 경로 제공 여부를 확인하거나 잠시 후 다시 시도해 주세요.", code="NO_REACHABLE_CANDIDATES")
    # 초 단위로 계산하며, 화면에 반올림된 시간은 정렬에 사용하지 않는다.
    for result in results:
        result["score_seconds"] = ranking_key(result)[0]
    results.sort(key=ranking_key)
    top = [{**p, "average": round(p["average_seconds"]/60, 1), "maximum": round(p["maximum_seconds"]/60, 1),
            "time_gap_minutes": round((max(p["member_seconds"])-min(p["member_seconds"]))/60, 1),
            "member_minutes": [round(s/60, 1) for s in p["member_seconds"]]} for p in results[:3]]
    return {"center": {"latitude": center["y"], "longitude": center["x"]}, "candidate_count": len(candidates),
            "evaluated_count": len(results), "excluded_count": excluded, "ranking_rule": "최대 이동시간 + 멤버 간 시간 차이 × 0.5가 작은 순 → 동점이면 평균 이동시간이 짧은 순",
            "candidate_strategy": "거점 기반 예상시간으로 최대 5곳 선별 후 전원의 경로를 확인해 최종 정렬 (예상시간은 최종 결과에 사용하지 않음)", "recommendation_policy": RECOMMENDATION_POLICY, "recommendations": top}
