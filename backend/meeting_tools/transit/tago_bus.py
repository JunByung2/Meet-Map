"""TAGO 버스정류소 조회. 인증키는 서버 환경변수에서만 읽는다."""
import argparse
from collections import OrderedDict
from copy import deepcopy
import hashlib
import math
import os
from pathlib import Path
import threading
import time
from urllib.parse import unquote
import xml.etree.ElementTree as ET

from dotenv import load_dotenv
import requests

load_dotenv(Path(__file__).resolve().parents[2] / ".env")
BASE_URL = "https://apis.data.go.kr/1613000/BusSttnInfoInqireService"
CACHE_TTL = 300
_cache = OrderedDict()
_lock = threading.Lock()


class TagoError(Exception):
    def __init__(self, message, code="UNAVAILABLE", status_code=502):
        super().__init__(message)
        self.code, self.status_code = code, status_code


def _key():
    value = os.getenv("TAGO_BUS_SERVICE_KEY", "").strip()
    if not value:
        raise TagoError("backend/.env에 TAGO_BUS_SERVICE_KEY를 설정해 주세요.", "NOT_CONFIGURED", 503)
    return unquote(value)


def is_configured():
    return bool(os.getenv("TAGO_BUS_SERVICE_KEY", "").strip())


def _raise_code(code):
    value = str(code).strip()
    if value in ("0", "00", "0000"):
        return
    if value in ("3", "03"):
        return
    if value in ("20", "29", "30", "31", "32"):
        raise TagoError("TAGO 인증키와 버스정류소정보 API 활용 승인 상태를 확인해 주세요.", "AUTH_FAILED")
    if value in ("22", "23"):
        raise TagoError("TAGO 요청 한도를 초과했어요. 잠시 후 다시 시도해 주세요.", "RATE_LIMITED")
    if value in ("5", "05"):
        raise TagoError("TAGO 정류장 조회가 지연되고 있어요. 잠시 후 다시 시도해 주세요.", "TIMEOUT", 504)
    raise TagoError("TAGO가 정류장 요청을 처리하지 못했어요. 활용 승인과 API 상태를 확인해 주세요.", "PROVIDER_ERROR")


def _read(response):
    try:
        data = response.json()
    except ValueError:
        try:
            tree = ET.fromstring(response.text)
            for element in tree.iter():
                element.tag = element.tag.split("}")[-1]
            code = tree.findtext(".//resultCode") or tree.findtext(".//returnReasonCode")
            if code is None:
                raise TagoError("TAGO 응답 형식을 확인하지 못했어요.", "BAD_RESPONSE")
            _raise_code(code)
            items = [{child.tag: child.text or "" for child in item} for item in tree.findall(".//items/item")]
            return items, tree.findtext(".//totalCount")
        except ET.ParseError:
            raise TagoError("TAGO 응답 형식을 확인하지 못했어요.", "BAD_RESPONSE") from None
    if not isinstance(data, dict) or not isinstance(data.get("response"), dict):
        raise TagoError("TAGO 응답 형식을 확인하지 못했어요.", "BAD_RESPONSE")
    envelope = data["response"]
    header = envelope.get("header")
    if not isinstance(header, dict) or "resultCode" not in header:
        raise TagoError("TAGO 응답 형식을 확인하지 못했어요.", "BAD_RESPONSE")
    _raise_code(header["resultCode"])
    body = envelope.get("body") or {}
    if not isinstance(body, dict):
        raise TagoError("TAGO 응답 형식을 확인하지 못했어요.", "BAD_RESPONSE")
    items = body.get("items") or {}
    if not isinstance(items, dict):
        raise TagoError("TAGO 정류장 목록 형식을 확인하지 못했어요.", "BAD_RESPONSE")
    rows = items.get("item") or []
    if isinstance(rows, dict):
        rows = [rows]
    if not isinstance(rows, list):
        raise TagoError("TAGO 정류장 목록 형식을 확인하지 못했어요.", "BAD_RESPONSE")
    return rows, body.get("totalCount")


def _request(operation, params):
    key = _key()
    cache_key = (hashlib.sha256(key.encode()).hexdigest(), operation, tuple(sorted(params.items())))
    now = time.monotonic()
    with _lock:
        cached = _cache.get(cache_key)
        if cached and cached[0] > now:
            _cache.move_to_end(cache_key)
            return deepcopy(cached[1])
    try:
        response = requests.get(f"{BASE_URL}/{operation}",
            params={**params, "serviceKey": key, "_type": "json"}, timeout=(3, 8))
        # 키가 포함될 수 있는 HTTP 예외·응답 원문은 외부에 전달하거나 기록하지 않는다.
        response.raise_for_status()
    except requests.exceptions.Timeout:
        raise TagoError("TAGO 정류장 조회 시간이 초과됐어요. 다시 시도해 주세요.", "TIMEOUT", 504) from None
    except requests.exceptions.HTTPError as error:
        status = error.response.status_code if error.response is not None else None
        if status in (401, 403):
            raise TagoError("TAGO 인증키와 버스정류소정보 API 활용 승인 상태를 확인해 주세요.", "AUTH_FAILED") from None
        raise TagoError("TAGO 서버 요청에 실패했어요. 잠시 후 다시 시도해 주세요.") from None
    except requests.exceptions.RequestException:
        raise TagoError("TAGO 서버에 연결하지 못했어요. 인터넷 연결과 API 상태를 확인해 주세요.") from None
    result = _read(response)
    with _lock:
        _cache[cache_key] = (time.monotonic() + CACHE_TTL, deepcopy(result))
        _cache.move_to_end(cache_key)
        while len(_cache) > 256:
            _cache.popitem(last=False)
    return result


def fetch_cities():
    rows, _ = _request("getCtyCodeList", {})
    result = []
    for row in rows:
        if isinstance(row, dict) and row.get("citycode") is not None and row.get("cityname"):
            result.append({"city_code": str(row["citycode"]), "name": str(row["cityname"])})
    return {"source": "TAGO", "count": len(result), "cities": result}


def fetch_nearby(latitude, longitude):
    if any(isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value)
           or abs(value) > maximum for value, maximum in ((latitude, 90), (longitude, 180))):
        raise TagoError("위도·경도 값을 확인해 주세요.", "INVALID_COORDINATES", 422)
    # TAGO 자체 검색 반경은 500m. 임의의 radius 파라미터를 추가하지 않는다.
    rows, total = _request("getCrdntPrxmtSttnList", {
        "gpsLati": round(latitude, 6), "gpsLong": round(longitude, 6), "numOfRows": 100, "pageNo": 1,
    })
    stations, seen = [], set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            city, node = str(row["citycode"]), str(row["nodeid"]).strip()
            name = str(row["nodenm"]).strip()
            lat, lng = float(row["gpslati"]), float(row["gpslong"])
        except (KeyError, TypeError, ValueError):
            continue
        if not node or not name or not math.isfinite(lat) or not math.isfinite(lng) or not (-90 <= lat <= 90 and -180 <= lng <= 180):
            continue
        if (city, node) in seen:
            continue
        seen.add((city, node))
        stations.append({"id": f"tago:{city}:{node}", "city_code": city, "station_id": node,
            "name": name, "latitude": lat, "longitude": lng, "source": "TAGO"})
    try:
        total_count = max(0, int(total)) if total is not None else len(rows)
    except (TypeError, ValueError):
        total_count = len(rows)
    return {"source": "TAGO", "radius_m": 500, "count": len(stations),
            "total_count": total_count, "truncated": total_count > len(rows), "stations": stations}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TAGO 연결 확인: 인증키를 출력하지 않습니다.")
    parser.add_argument("--latitude", type=float)
    parser.add_argument("--longitude", type=float)
    args = parser.parse_args()
    if (args.latitude is None) != (args.longitude is None):
        parser.error("latitude와 longitude를 함께 입력해 주세요.")
    try:
        if args.latitude is None:
            data = fetch_cities()
            print(f"TAGO 연결 성공: 도시 {data['count']}개")
            print(", ".join(city["name"] for city in data["cities"][:20]))
        else:
            data = fetch_nearby(args.latitude, args.longitude)
            print(f"TAGO 연결 성공: 반경 500m 정류장 {data['count']}개")
            for station in data["stations"][:20]:
                print(station["name"], station["station_id"])
    except TagoError as error:
        print(f"TAGO 확인 실패 [{error.code}]: {error}")
        raise SystemExit(1) from None
