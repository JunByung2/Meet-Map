from fastapi import APIRouter, HTTPException
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