"""지도 페이지 전용 상세 경로 API. 기존 인증·DB·추천 코드는 변경하지 않는다."""
import math

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from meeting_tools.transit.kakao_route import TransitError, fetch_kakao_routes

router = APIRouter(prefix="/transit", tags=["지도 교통"])


class Coordinate(BaseModel):
    x: float = Field(ge=-180, le=180, allow_inf_nan=False)
    y: float = Field(ge=-90, le=90, allow_inf_nan=False)


class RouteRequest(BaseModel):
    start: Coordinate
    end: Coordinate


def number(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if math.isfinite(value) and value >= 0:
            return value
    return None


def normalize_step(step):
    properties = step.get("properties", {})
    if not isinstance(properties, dict):
        properties = {}
    path = step.get("path", {})
    raw_points = path.get("points", []) if isinstance(path, dict) else []
    points = []
    if isinstance(raw_points, list):
        for pair in raw_points:
            if not isinstance(pair, (list, tuple)) or len(pair) != 2:
                continue
            x, y = pair
            if all(isinstance(v, (int, float)) and not isinstance(v, bool)
                   and math.isfinite(v) for v in (x, y)):
                if -180 <= x <= 180 and -90 <= y <= 90:
                    points.append([x, y])
    stops = properties.get("stops", [])
    vehicles = properties.get("vehicles", [])
    return {
        "mode": str(properties.get("type", "UNKNOWN")),
        "guidance": str(properties.get("guidance") or "상세 안내 없음"),
        "seconds": number(properties.get("time")),
        "distance": number(properties.get("distance")),
        "stops": [str(item["name"]) for item in stops
                  if isinstance(item, dict) and item.get("name")] if isinstance(stops, list) else [],
        "vehicles": [str(item["name"]) for item in vehicles
                     if isinstance(item, dict) and item.get("name")] if isinstance(vehicles, list) else [],
        "points": points,
    }


@router.post("/routes")
def transit_routes(body: RouteRequest):
    if abs(body.start.x - body.end.x) < 0.000001 and abs(body.start.y - body.end.y) < 0.000001:
        raise HTTPException(400, "출발지와 목적지가 같습니다.")
    try:
        raw_routes = fetch_kakao_routes(body.start.model_dump(), body.end.model_dump())
    except TransitError as error:
        raise HTTPException(502, str(error)) from None

    routes = []
    for index, raw in enumerate(raw_routes):
        if not isinstance(raw, dict):
            continue
        info = raw.get("properties", {})
        if not isinstance(info, dict):
            continue
        seconds = number(info.get("totalTime"))
        if seconds is None:
            continue
        fare = info.get("fare", {})
        if not isinstance(fare, dict):
            fare = {}
        steps = raw.get("steps", [])
        routes.append({
            "id": f"route-{index}", "mode": str(info.get("type", "UNKNOWN")),
            "seconds": seconds, "distance": number(info.get("totalDistance")),
            "transfers": number(info.get("transfers")),
            "fare": number(fare.get("value")),
            "fare_min": number(fare.get("min")), "fare_max": number(fare.get("max")),
            "steps": [normalize_step(step) for step in steps if isinstance(step, dict)]
            if isinstance(steps, list) else [],
        })
    if not routes:
        raise HTTPException(502, "표시할 수 있는 경로가 없습니다.")
    routes.sort(key=lambda route: route["seconds"])
    return {"routes": routes}
