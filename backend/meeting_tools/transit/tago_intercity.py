"""현재 출발 기준, 주요 거점 간 당일 직행 시간표와 시내 접근 시간을 조합한다."""
import math
import os
import re
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from time import time
from urllib.parse import unquote

import requests

from meeting_tools.transit.kakao_route import TransitError, fetch_kakao_routes
from meeting_tools.transit.tago_bus import TagoError, _read

KST = timezone(timedelta(hours=9))
# (표시명, 경도, 위도, TAGO ID). 시외버스 ID는 해당 서비스 목록에서 조회한다.
HUBS = {
    "TRAIN": [
        ("서울역", 126.9707, 37.5547, "NAT010000"),
        ("용산역", 126.9647, 37.5298, "NAT010032"),
        ("대전역", 127.4342, 36.3323, "NAT011668"),
        ("동대구역", 128.6285, 35.8794, "NAT013271"),
        ("부산역", 129.0415, 35.1151, "NAT014445"),
        ("광주송정역", 126.7915, 35.1372, "NAT031857"),
        ("목포역", 126.3866, 34.7911, "NAT032563"),
    ],
    "EXPRESSBUS": [
        ("서울경부", 127.0051, 37.5051, "NAEK010"),
        ("센트럴시티", 127.0024, 37.5043, "NAEK020"),
        ("대전복합", 127.4376, 36.3505, "NAEK300"),
        ("동대구", 128.6291, 35.8775, "NAEK801"),
        ("부산", 129.1335, 35.2857, "NAEK700"),
        ("광주유스퀘어", 126.8796, 35.1601, "NAEK500"),
    ],
    "INTERCITY": [
        ("해남", 126.6061, 34.5699, None), ("목포", 126.4202, 34.8105, None),
        ("부산서부", 128.9823, 35.1623, "NAI4696901"), ("해운대", 129.1594, 35.1632, None),
        ("동서울", 127.0944, 37.5345, None), ("광주", 126.8796, 35.1601, "NAI6193701"),
    ],
}
SERVICES = {"TRAIN": ("TrainInfo", "GetStrtpntAlocFndTrainInfo"),
            "EXPRESSBUS": ("ExpBusInfo", "GetStrtpntAlocFndExpbusInfo"),
            "INTERCITY": ("SuburbsBusInfo", "GetStrtpntAlocFndSuberbsBusInfo")}


def km(a, b):
    lat1, lat2 = math.radians(a["y"]), math.radians(b["y"])
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(math.radians(b["x"]-a["x"])/2)**2
    return 12742*math.asin(min(1, math.sqrt(h)))


def coord(hub):
    return {"x": hub[1], "y": hub[2]}


@lru_cache(maxsize=512)
def rows(service, operation, params, bucket, key):
    result = []
    for page in range(1, 51):
        try:
            response = requests.get(f"https://apis.data.go.kr/1613000/{service}/{operation}",
                params={**dict(params), "_type":"json", "pageNo":page, "numOfRows":100, "serviceKey":key},
                timeout=(2, 5))
            response.raise_for_status()
            items, total = _read(response)
        except (TagoError, requests.RequestException) as exc:
            raise TransitError("TAGO 시간표 조회에 실패했어요. 해당 서비스 활용 승인과 응답 상태를 확인해 주세요.",
                               getattr(exc, "code", "TAGO_HTTP")) from None
        result.extend({str(k).lower(): v for k, v in row.items()} for row in items if isinstance(row, dict))
        if not items or (total is not None and len(result) >= int(total)) or len(items) < 100:
            break
    return result


def lookup(service, operation, **params):
    key = unquote(os.getenv("TAGO_BUS_SERVICE_KEY", "").strip())
    return rows(service, operation, tuple(sorted(params.items())), int(time()//300), key)


REGIONS = {"서울":"서울", "부산":"부산", "경기":"경기", "강원":"강원", "충북":"충청북",
           "충남":"충청남", "전북":"전북", "전남":"전라남", "경북":"경상북", "경남":"경상남"}


def region(name):
    name = str(name).split()[0] if name else ""
    name = name.replace("전라북", "전북")
    return REGIONS.get(name, name).removesuffix("특별자치도").removesuffix("광역시").removesuffix("특별시").removesuffix("도")


@lru_cache(maxsize=512)
def places(x, y, keyword, bucket, wide=False):
    try:
        response = requests.get("https://dapi.kakao.com/v2/local/search/keyword.json",
            headers={"Authorization":"KakaoAK " + os.getenv("KAKAO_REST_API_KEY", "")},
            params={"x":x, "y":y, **({} if wide else {"radius":20000}), "query":keyword, "sort":"distance", "size":15}, timeout=(2, 4))
        response.raise_for_status()
        return response.json()["documents"]
    except (requests.RequestException, KeyError, ValueError, TypeError):
        return []


def rail_name(name):
    return str(name).replace(" ", "").removesuffix("역").upper().replace("엑스포", "EXPO")


def station_ids(name, city):
    service = SERVICES["TRAIN"][0]
    cities = lookup(service, "GetCtyCodeList")
    def matches(codes):
        return {row["nodeid"] for code in codes
                for row in lookup(service, "GetCtyAcctoTrainSttnList", cityCode=code)
                if rail_name(row.get("nodename")) == rail_name(name) and row.get("nodeid")}
    local = matches(c["citycode"] for c in cities if region(c.get("cityname")) == city)
    if local:
        return local
    # 공급자별 행정구역명이 다른 경우 전국에서 유일한 역명만 연결한다.
    return matches(c["citycode"] for c in cities)


def nearby_hubs(point, mode):
    keyword = "기차역" if mode == "TRAIN" else "버스터미널"
    service = SERVICES[mode][0]
    docs = places(point["x"], point["y"], keyword, int(time()//300))
    if not docs:
        docs = places(point["x"], point["y"], keyword, int(time()//300), wide=True)
    hubs = []
    for doc in docs:
        if km(point, {"x":float(doc["x"]), "y":float(doc["y"])}) > 65:
            continue
        category = doc.get("category_name", "").split(" > ")
        name = doc.get("place_name", "")
        if mode == "TRAIN":
            if "기차역" not in category or category[-1] not in ("기차역", "KTX역", "SRT역", "KTX정차역", "SRT정차역"):
                continue
            city = region(doc.get("address_name"))
            ids = station_ids(name.split()[0], city)
        else:
            if "터미널" not in category[-1] or not name.endswith("터미널"):
                continue
            station = re.sub(r"(?:종합|공용|시외|고속|여객|버스|터미널)+$", "", name).strip()
            if not station:
                continue
            operation = "GetExpBusTrminlList" if mode == "EXPRESSBUS" else "GetSuberbsBusTrminlList"
            stations = lookup(service, operation, terminalNm=station)
            ids = {r.get("terminalid") for r in stations if r.get("terminalnm") in (name, station)}
        ids.discard(None)
        if len(ids) == 1:
            hub = name, float(doc["x"]), float(doc["y"]), ids.pop()
            if not any(other[3] == hub[3] for other in hubs):
                hubs.append(hub)
            if len(hubs) == 3:
                break
    return hubs


def terminal(hub):
    if hub[3]:
        return hub[3]
    matches = lookup("SuburbsBusInfo", "GetSuberbsBusTrminlList", terminalNm=hub[0])
    ids = {r.get("terminalid") for r in matches if r.get("terminalnm") == hub[0]}
    return ids.pop() if len(ids) == 1 else None


def feeder(a, b):
    if km(a, b) <= 0.05:
        return {"properties":{"totalTime":0, "transfers":0}, "steps":[]}
    # 역 입구와 승강장 대표 좌표 사이에는 대중교통 경로가 없을 수 있다.
    distance = km(a, b)
    if distance <= 0.5:
        meters = math.ceil(distance * 1000 * 1.3)
        seconds = math.ceil(meters / 1.1)
        return {"properties": {"totalTime": seconds, "transfers": 0},
                "steps": [{"properties": {"type": "WALKING", "time": seconds,
                           "distance": meters, "guidance": "역·터미널 주변 도보 (직선거리 기반 추정)"}}]}
    routes = fetch_kakao_routes(a, b)
    usable = [r for r in routes if isinstance(r, dict) and
              isinstance(r.get("properties", {}).get("totalTime"), (int, float)) and
              r["properties"]["totalTime"] > 0]
    if not usable:
        raise TransitError("역·터미널 연결 경로를 찾지 못했어요.", "NO_ROUTE")
    return min(usable, key=lambda r:r["properties"]["totalTime"])


def schedule_time(raw):
    value = str(raw)
    if len(value) == 12:
        value += "00"
    if len(value) != 14:
        raise ValueError("invalid timestamp")
    return datetime.strptime(value, "%Y%m%d%H%M%S").replace(tzinfo=KST)


def trips(mode, origin, dest, now):
    a, b = terminal(origin), terminal(dest)
    if not a or not b or a == b:
        return []
    params = {"depPlandTime":now.strftime("%Y%m%d")}
    if mode == "TRAIN":
        params.update(depPlaceId=a, arrPlaceId=b)
    else:
        params.update(depTerminalId=a, arrTerminalId=b)
    services = lookup(*SERVICES[mode], **params)
    departures = []
    for row in services:
        try:
            dep, arr = schedule_time(row["depplandtime"]), schedule_time(row["arrplandtime"])
        except (ValueError, KeyError):
            continue
        if arr > dep >= now:
            departures.append((arr, dep, row))
    return departures


def amount(value):
    text = str(value).strip().replace(",", "")
    if text.isascii() and text.isdecimal() and int(text) > 0:
        return int(text)
    return None


def journey_fare(tickets, feeders):
    ranges = []
    for ticket in tickets:
        price = amount(ticket.get("adultcharge")) or amount(ticket.get("charge"))
        ranges.append((price, price))
    for part in feeders:
        props = part["properties"]
        modes = [s.get("properties", {}).get("type") for s in part.get("steps", [])]
        if props.get("totalTime") == 0 or (modes and all(m in ("WALKING", "WAIT") for m in modes)):
            continue
        fare = props.get("fare") or {}
        value = amount(fare.get("value"))
        ranges.append((value or amount(fare.get("min")), value or amount(fare.get("max"))))
    known = [(a,b) for a,b in ranges if a is not None and b is not None and a <= b]
    if not known:
        return {}
    low = sum(a for a,b in known)
    high = sum(b for a,b in known)
    return {"min":low, "max":high, "value":low if low == high else None,
            "partial":len(known) < len(ranges)}


def missing_lines(start, end, route=None):
    def xy(point):
        return [point["x"], point["y"]]
    previous = xy(start)
    gaps = []
    for step in (route or {}).get("steps", []):
        points = (step.get("path") or {}).get("points") or []
        valid = [list(q) for q in points if isinstance(q, (list, tuple)) and len(q) == 2
                 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in q)]
        if len(valid) < 2:
            continue
        if previous != valid[0]:
            gaps.append([previous, valid[0]])
        previous = valid[-1]
    if previous != xy(end):
        gaps.append([previous, xy(end)])
    return gaps


def compose(start, end, mode, origin, dest, now, via=None, onward_mode=None, boarding=None):
    departures = trips(mode, origin, via or dest, now)
    if not departures:
        return None
    first = feeder(start, coord(origin))
    ready = now + timedelta(seconds=first["properties"]["totalTime"])
    eligible = [trip for trip in departures if trip[1] >= ready + timedelta(minutes=10)]
    if not eligible:
        return None
    onward = None
    if via:
        onward_mode = onward_mode or mode
        boarding = boarding or via
        second = trips(onward_mode, boarding, dest, now)
        if not second:
            return None
        # Same terminal/station transfer; allow ten minutes between services.
        first_trip = min(eligible, key=lambda trip:trip[:2])
        transfer = feeder(coord(via), coord(boarding))
        transfer_end = first_trip[0] + timedelta(seconds=transfer["properties"]["totalTime"])
        available = [trip for trip in second if trip[1] >= transfer_end + timedelta(minutes=10)]
        if not available:
            return None
        onward = min(available, key=lambda trip:trip[:2])
        arr, dep, row = first_trip
    else:
        arr, dep, row = min(eligible, key=lambda trip:trip[:2])
    last = feeder(coord(dest), end)
    label = {"TRAIN":"열차", "EXPRESSBUS":"고속버스", "INTERCITY":"시외버스"}[mode]
    name = row.get("traingradename") or label
    wait = {"properties":{"type":"WAIT","time":(dep-ready).total_seconds(),
            "guidance":origin[0]+" 승차 준비·대기"}}
    main = {"properties":{"type":"TRAIN" if mode=="TRAIN" else "EXPRESSBUS",
            "time":(arr-dep).total_seconds(), "vehicles":[{"name":name}],
            "guidance":f"{origin[0]} {dep:%H:%M} → {dest[0]} {arr:%H:%M} · {label}",
            "stops":[{"name":origin[0]}, {"name":dest[0]}]}}
    steps = [*first.get("steps", []), wait, main]
    if onward:
        main["properties"]["stops"][-1] = {"name":via[0]}
        main["properties"]["guidance"] = f"{origin[0]} {dep:%H:%M} → {via[0]} {arr:%H:%M} · {label}"
        final, change, vehicle = onward
        steps.extend(transfer.get("steps", []))
        label = {"TRAIN":"열차", "EXPRESSBUS":"고속버스", "INTERCITY":"시외버스"}[onward_mode]
        steps.extend([{"properties":{"type":"WAIT", "time":(change-transfer_end).total_seconds(),
                      "guidance":boarding[0]+" 환승 대기"}},
                      {"properties":{"type":"TRAIN" if onward_mode=="TRAIN" else "EXPRESSBUS", "time":(final-change).total_seconds(),
                      "guidance":f"{boarding[0]} {change:%H:%M} → {dest[0]} {final:%H:%M} · {label}",
                      "stops":[{"name":boarding[0]}, {"name":dest[0]}],
                      "vehicles":[{"name":vehicle.get("traingradename") or label}]}}])
        arr = final
    steps.extend(last.get("steps", []))
    # TAGO 시간표에는 선형 좌표가 없으므로 거점 사이를 직선으로 표시한다.
    anchors = [start, coord(origin)]
    if onward:
        anchors.extend([coord(via), coord(boarding)])
    anchors.extend([coord(dest), end])
    gaps = missing_lines(start, coord(origin), first)
    gaps.extend(missing_lines(coord(origin), coord(via or dest)))
    tickets, feeders = [row], [first, last]
    if onward:
        gaps.extend(missing_lines(coord(via), coord(boarding), transfer))
        gaps.extend(missing_lines(coord(boarding), coord(dest)))
        tickets.append(vehicle)
        feeders.append(transfer)
    gaps.extend(missing_lines(coord(dest), end, last))
    line = [[point["x"], point["y"]] for point in anchors]
    meters = round(sum(km(a, b) * 1000 for a, b in zip(anchors, anchors[1:])))
    boardings = sum(step.get("properties", {}).get("type") in
                    ("BUS", "SUBWAY", "TRAIN", "EXPRESSBUS") for step in steps)
    return {"properties":{"type":main["properties"]["type"],
            "gapLines": gaps, "fare":journey_fare(tickets, feeders), "hubLine": line, "totalDistance": meters, "transfers": max(0, boardings - 1),
            "totalTime":(arr-now).total_seconds()+last["properties"]["totalTime"]},
            "steps":steps}


def hub_options(point, mode, errors):
    fixed = sorted(HUBS[mode], key=lambda hub: km(point, coord(hub)))
    fixed = [hub for hub in fixed if km(point, coord(hub)) <= 65][:2]
    try:
        nearby = nearby_hubs(point, mode)
    except TransitError as exc:
        errors.append(exc)
        nearby = []
    options = nearby + fixed
    unique = []
    for hub in options:
        if not any(hub == old or (hub[3] and hub[3] == old[3]) for old in unique):
            unique.append(hub)
    return unique


def intercity_routes(start, end):
    now = datetime.now(KST)
    choices, errors = [], []
    middle_options = {}
    def middle_hubs(mode):
        if mode not in middle_options:
            middle_options[mode] = hub_options(middle, mode, errors)
        return middle_options[mode]
    transfer_pairs = []
    for mode in HUBS:
        origins = hub_options(start, mode, errors)
        destinations = hub_options(end, mode, errors)
        pairs = sorted(((a, b) for a in origins for b in destinations if a != b),
                       key=lambda pair: km(start, coord(pair[0])) + km(end, coord(pair[1])))
        transfer_pairs.extend((mode, a, b) for a, b in pairs[:1])
        for origin, dest in pairs[:6]:
            try:
                route = compose(start, end, mode, origin, dest, now)
            except TransitError as exc:
                errors.append(exc)
                continue
            if route:
                choices.append(route)
                break
    if choices:
        return sorted(choices, key=lambda r:r["properties"]["totalTime"])
    middle = {"x":(start["x"]+end["x"])/2, "y":(start["y"]+end["y"])/2}
    for mode, origin, dest in transfer_pairs:
        midpoints = middle_hubs(mode) + HUBS[mode]
        seen = {origin, dest}
        tried = 0
        for via in sorted(midpoints, key=lambda h:km(middle, coord(h))):
            if via in seen or (via[3] and via[3] in (origin[3], dest[3])):
                continue
            seen.add(via)
            try:
                route = compose(start, end, mode, origin, dest, now, via)
            except TransitError as exc:
                errors.append(exc)
            else:
                if route:
                    return [route]
            tried += 1
            if tried >= 3:
                break
    for mode, origin, _ in transfer_pairs:
        for second_mode, _, dest in transfer_pairs:
            if (mode == "TRAIN") == (second_mode == "TRAIN"):
                continue
            connections = [(a, b) for a in middle_hubs(mode)
                           for b in middle_hubs(second_mode)
                           if km(coord(a), coord(b)) <= 15]
            for a, b in connections[:2]:
                try:
                    route = compose(start, end, mode, origin, dest, now, a, second_mode, b)
                except TransitError as exc:
                    errors.append(exc)
                else:
                    if route:
                        return [route]
    if errors:
        raise errors[0]
    raise TransitError("오늘 연결 가능한 주요 역·터미널 직행·환승 시간표를 찾지 못했어요.", "NO_ROUTE")
