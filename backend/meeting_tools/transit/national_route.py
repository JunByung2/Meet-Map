"""TMAP 대중교통 경로를 지도와 추천에서 공통으로 사용한다."""
import math
import os

import requests

from meeting_tools.transit.kakao_route import TransitError, fetch_kakao_routes

from meeting_tools.transit.tago_intercity import intercity_routes, km


def tago_enabled():
    return os.getenv("TAGO_INTERCITY_ENABLED", "").strip().lower() in ("1", "true", "yes")


MODES = {"WALK": "WALKING", "BUS": "BUS", "SUBWAY": "SUBWAY",
         "TRAIN": "TRAIN", "EXPRESSBUS": "EXPRESSBUS"}


def points_for(leg):
    shape = (leg.get("passShape") or {}).get("linestring")
    lines = [shape] if shape else [step.get("linestring", "") for step in leg.get("steps", [])]
    points = []
    for line in lines:
        for pair in line.split():
            try:
                x, y = map(float, pair.split(","))
            except ValueError:
                continue
            if -180 <= x <= 180 and -90 <= y <= 90:
                points.append([x, y])
    return points


def convert(item):
    seconds = item.get("totalTime")
    legs = item.get("legs")
    if type(seconds) not in (float, int) or not math.isfinite(seconds) or seconds <= 0 or not legs:
        return None
    steps = []
    for leg in legs:
        mode = MODES.get(leg.get("mode"))
        if not mode or str(leg.get("service")) == "0":
            return None
        start = (leg.get("start") or {}).get("name", "")
        end = (leg.get("end") or {}).get("name", "")
        stations = (leg.get("passStopList") or {}).get("stations", [])
        names = [station.get("stationName") for station in stations] or [start, end]
        routes = [leg.get("route")] + [lane.get("route") for lane in leg.get("lane", [])]
        steps.append({"properties": {"type": mode, "time": leg.get("sectionTime"),
                      "distance": leg.get("distance"), "guidance": f"{start} → {end}",
                      "stops": [{"name": n} for n in names if n],
                      "vehicles": [{"name": n} for n in dict.fromkeys(routes) if n]},
                      "path": {"points": points_for(leg)}})
    modes = {step["properties"]["type"] for step in steps}
    mode = next((m for m in ("TRAIN", "EXPRESSBUS") if m in modes), None)
    if not mode:
        mode = "BUS_AND_SUBWAY" if {"BUS", "SUBWAY"} <= modes else next(
            (m for m in ("SUBWAY", "BUS") if m in modes), "WALKING")
    fare = ((item.get("fare") or {}).get("regular") or {}).get("totalFare")
    return {"properties": {"type": mode, "totalTime": seconds, "fare": {"value": fare},
            "totalDistance": item.get("totalDistance"), "transfers": item.get("transferCount")},
            "steps": steps}


def fetch_transit_routes(start, end):
    if tago_enabled():
        local_first = km(start, end) < 60
        if local_first:
            try:
                return fetch_kakao_routes(start, end)
            except TransitError as exc:
                if exc.code not in ("PROVIDER_NOT_OK", "NO_ROUTE", "NO_TIME"):
                    raise
        if not os.getenv("TAGO_BUS_SERVICE_KEY", "").strip():
            raise TransitError("TAGO 인증키를 설정해 주세요.", "NOT_CONFIGURED")
        try:
            return intercity_routes(start, end)
        except TransitError as schedule_error:
            if local_first:
                raise
            # 장거리 직행 시간표가 없어도 기존 길찾기에 광역 경로가 있을 수 있다.
            try:
                return fetch_kakao_routes(start, end)
            except TransitError:
                raise schedule_error from None
    key = os.getenv("TMAP_APP_KEY", "").strip()
    if not key:
        return fetch_kakao_routes(start, end)
    try:
        response = requests.post("https://apis.openapi.sk.com/transit/routes",
            headers={"appKey": key, "Accept": "application/json"},
            json={"startX": str(start["x"]), "startY": str(start["y"]),
                  "endX": str(end["x"]), "endY": str(end["y"]), "count": 5},
            timeout=(3, 12))
        response.raise_for_status()
    except requests.Timeout:
        raise TransitError("대중교통 경로 조회 시간이 초과됐어요.", "TIMEOUT") from None
    except requests.HTTPError:
        if response.status_code in (401, 403):
            raise TransitError("TMAP 대중교통 키와 사용 권한을 확인해 주세요.", "AUTH_FAILED") from None
        if response.status_code == 429:
            raise TransitError("TMAP 호출 한도를 초과했어요.", "RATE_LIMITED") from None
        raise TransitError("TMAP 경로 요청이 실패했어요.", "HTTP_ERROR") from None
    except requests.RequestException:
        raise TransitError("TMAP에 연결할 수 없어요.", "NETWORK_ERROR") from None
    try:
        data = response.json()
        if data.get("result") and "metaData" not in data:
            raise TransitError("TMAP에서 이 구간의 경로를 반환하지 않았어요.", "PROVIDER_NOT_OK")
        items = data["metaData"]["plan"]["itineraries"]
        routes = [route for item in items if (route := convert(item))]
    except (AttributeError, KeyError, ValueError, TypeError):
        raise TransitError("TMAP 응답 형식을 확인할 수 없어요.", "BAD_RESPONSE") from None
    if not routes:
        raise TransitError("이 구간에서 이용 가능한 철도·버스 경로를 찾지 못했어요.", "NO_ROUTE")
    return routes
