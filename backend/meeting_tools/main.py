from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from meeting_tools.recommendation.recommend_service import recommend_places
from meeting_tools.transit.routes import router as transit_map_router

from meeting_tools.transit.seoul_bus import router as seoul_bus_router
from meeting_tools.transit.kakao_route import (
    TransitError,
    fetch_kakao_routes,
    get_fastest_seconds,
)


app = FastAPI(title="MeetMap 장소 추천 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class Location(BaseModel):
    x: float = Field(ge=-180, le=180)  # 경도
    y: float = Field(ge=-90, le=90)    # 위도


class TransitRequest(BaseModel):
    start: Location
    end: Location


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "meeting-recommendation",
    }


@app.post("/transit")
def transit(body: TransitRequest):
    try:
        routes = fetch_kakao_routes(
            body.start.model_dump(),
            body.end.model_dump(),
        )
        seconds = get_fastest_seconds(routes)

    except TransitError as error:
        raise HTTPException(
            status_code=502,
            detail=str(error),
        ) from None

    return {
        "seconds": seconds,
        "minutes": round(seconds / 60, 1),
        "route_count": len(routes),
    }

class RecommendRequest(BaseModel):
    departures: list[Location] = Field(min_length=2, max_length=5)


@app.post("/recommend")
def recommend(body: RecommendRequest):
    try:
        return recommend_places([
            place.model_dump()
            for place in body.departures
        ])

    except TransitError as error:
        raise HTTPException(
            status_code=502,
            detail=str(error),
        ) from None
app.include_router(transit_map_router)
app.include_router(seoul_bus_router)