import os
import math
from pathlib import Path
from xml.etree import ElementTree

import time
from meeting_tools.transit.arrival_status import normalize_arrivals
import requests
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Query


load_dotenv(Path(__file__).resolve().parents[2] / ".env")

router = APIRouter(
    prefix="/seoul-bus",
    tags=["서울 실시간 버스"],
)


def coordinate(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


@router.get("/stations")
def search_stations(
    keyword: str = Query(min_length=1, max_length=100),
):
    keyword = keyword.strip()

    if not keyword:
        raise HTTPException(400, "정류장 이름을 입력해 주세요.")

    key = os.getenv("SEOUL_BUS_STATION_SERVICE_KEY")

    if not key:
        raise HTTPException(
            503,
            "정류소 API 인증키가 설정되지 않았습니다.",
        )

    try:
        response = requests.get(
            "http://ws.bus.go.kr/api/rest/stationinfo/getStationByName",
            params={
                "serviceKey": key,
                "stSrch": keyword,
            },
            timeout=15,
        )
        response.raise_for_status()

    except requests.exceptions.Timeout:
        raise HTTPException(
            504,
            "정류장 조회 시간이 초과되었습니다.",
        ) from None

    except requests.exceptions.RequestException:
        # 예외 원문에는 인증키가 포함된 URL이 있을 수 있어 반환하지 않음
        raise HTTPException(
            502,
            "서울 버스 API에 연결하지 못했습니다.",
        ) from None

    try:
        root = ElementTree.fromstring(response.content)

    except ElementTree.ParseError:
        raise HTTPException(
            502,
            "서울 버스 API 응답을 해석하지 못했습니다.",
        ) from None

    code = root.findtext(".//headerCd")

    if code != "0":
        raise HTTPException(
            502,
            "정류장 조회가 승인되지 않았거나 API가 오류를 반환했습니다. "
            "정류소 서비스 승인 상태와 Decoding 인증키를 확인해 주세요.",
        )

    stations = []

    for item in root.findall(".//itemList"):
        station_id = item.findtext("stId")

        if not station_id:
            continue

        stations.append({
            "station_id": station_id,
            "ars_id": item.findtext("arsId"),
            "name": item.findtext("stNm"),
            "longitude": coordinate(item.findtext("tmX")),
            "latitude": coordinate(item.findtext("tmY")),
        })

    return {
        "keyword": keyword,
        "count": len(stations),
        "stations": stations,
    }

@router.get("/station-routes")
def station_routes(
    ars_id: str = Query(pattern=r"^\d{5}$"),
):
    key = os.getenv("SEOUL_BUS_STATION_SERVICE_KEY")

    if not key:
        raise HTTPException(503, "정류소 API 인증키가 없습니다.")

    try:
        response = requests.get(
            "http://ws.bus.go.kr/api/rest/stationinfo/getRouteByStation",
            params={
                "serviceKey": key,
                "arsId": ars_id,
            },
            timeout=15,
        )
        response.raise_for_status()

    except requests.exceptions.Timeout:
        raise HTTPException(
            504, "경유 노선 조회 시간이 초과되었습니다."
        ) from None

    except requests.exceptions.RequestException:
        raise HTTPException(
            502, "서울 버스 서버에 연결하지 못했습니다."
        ) from None

    try:
        root = ElementTree.fromstring(response.content)

    except ElementTree.ParseError:
        raise HTTPException(
            502, "경유 노선 응답을 해석하지 못했습니다."
        ) from None

    if root.findtext(".//headerCd") != "0":
        raise HTTPException(
            502, "경유 노선 조회에 실패했습니다."
        )

    routes = []

    for item in root.findall(".//itemList"):
        # 응답에 존재하는 항목만 반환
        fields = [
            "busRouteId",
            "busRouteNm",
            "staOrd",
            "next",
            "direction",
            "stBegin",
            "stEnd",
        ]

        routes.append({
            field: item.findtext(field)
            for field in fields
            if item.findtext(field) is not None
        })

    return {
        "ars_id": ars_id,
        "count": len(routes),
        "routes": routes,
    }

@router.get("/station-arrivals")
def station_arrivals(
    ars_id: str = Query(pattern=r"^\d{5}$"),
):
    key = os.getenv("SEOUL_BUS_STATION_SERVICE_KEY")

    if not key:
        raise HTTPException(503, "정류소 API 인증키가 없습니다.")

    try:
        response = requests.get(
            "http://ws.bus.go.kr/api/rest/stationinfo/getStationByUid",
            params={
                "serviceKey": key,
                "arsId": ars_id,
            },
            timeout=15,
        )
        response.raise_for_status()

    except requests.exceptions.Timeout:
        raise HTTPException(
            504, "버스 도착 정보 조회 시간이 초과되었습니다."
        ) from None

    except requests.exceptions.RequestException:
        raise HTTPException(
            502, "서울 버스 서버에 연결하지 못했습니다."
        ) from None

    try:
        root = ElementTree.fromstring(response.content)

    except ElementTree.ParseError:
        raise HTTPException(
            502, "도착 정보 응답을 해석하지 못했습니다."
        ) from None

    if root.findtext(".//headerCd") != "0":
        raise HTTPException(
            502, "정류장 도착 정보 조회에 실패했습니다."
        )

    arrivals = []

    for item in root.findall(".//itemList"):
        fields = [
            "stId",
            "stNm",
            "arsId",
            "busRouteId",
            "rtNm",
            "staOrd",
            "nxtStn",
            "adirection",
            "arrmsg1",
            "arrmsg2",
            "traTime1",
            "traTime2",
        ]

        arrivals.append({
            field: item.findtext(field)
            for field in fields
            if item.findtext(field) is not None
        })

    return {
        "ars_id": ars_id,
        "count": len(arrivals),
        "arrivals": arrivals,
    }
@router.get("/arrival-status")
def normalized_arrival_status(
    ars_id: str = Query(pattern=r"^\d{5}$"),
):
    observed_at_ms = int(time.time() * 1000)
    raw = station_arrivals(ars_id=ars_id)
    received_at_ms = int(time.time() * 1000)

    return normalize_arrivals(
        raw,
        observed_at_ms,
        received_at_ms,
    )