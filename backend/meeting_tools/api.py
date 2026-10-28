from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from meeting_tools.recommendation.recommend_service import recommend_places
from meeting_tools.transit.kakao_route import (
    TransitError,
    fetch_kakao_routes,
    get_fastest_seconds,
)

# 로그인 검사는 app/main.py 에서 include_router(..., dependencies=[...]) 로 한 번에 건다.
router = APIRouter(tags=["meeting-tools"])


class Location(BaseModel):
    x: float = Field(ge=-180, le=180)  # 경도
    y: float = Field(ge=-90, le=90)    # 위도


class TransitRequest(BaseModel):
    start: Location
    end: Location


class RecommendRequest(BaseModel):
    departures: list[Location] = Field(min_length=2, max_length=5)


@router.post("/transit")
def transit(body: TransitRequest):
    try:
        routes = fetch_kakao_routes(
            body.start.model_dump(),
            body.end.model_dump(),
        )
        seconds = get_fastest_seconds(routes)
    except TransitError as error:
        raise HTTPException(status_code=502, detail=str(error)) from None

    return {
        "seconds": seconds,
        "minutes": round(seconds / 60, 1),
        "route_count": len(routes),
    }


@router.post("/recommend")
def recommend(body: RecommendRequest):
    try:
        return recommend_places([place.model_dump() for place in body.departures])
    except TransitError as error:
        raise HTTPException(status_code=502, detail=str(error)) from None

# app.main에 등록된 meeting_router의 로그인 검사를 그대로 적용한다.
@router.get("/tago-bus/cities")
def tago_cities():
    from meeting_tools.transit.tago_bus import TagoError, fetch_cities
    try:
        return fetch_cities()
    except TagoError as error:
        raise HTTPException(error.status_code, str(error)) from None


@router.get("/tago-bus/stations")
def tago_stations(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
):
    from meeting_tools.transit.tago_bus import TagoError, fetch_nearby
    try:
        return fetch_nearby(latitude, longitude)
    except TagoError as error:
        raise HTTPException(error.status_code, str(error)) from None
