"""서울 도착 응답 정규화. 상태 문구가 숫자보다 우선한다."""
import re


def arrival_status(message, raw_seconds, observed_at_ms):
    message = str(message or "").strip()
    base = {"message": message or "정보 없음", "seconds": None,
            "arrival_at_ms": None, "status": "unavailable"}
    if "운행종료" in message:
        return {**base, "status": "ended"}
    if any(word in message for word in ("출발대기", "회차대기", "차고지")):
        return {**base, "status": "waiting"}
    if "곧" in message or "진입" in message:
        return {**base, "status": "imminent"}
    # 숫자 자체만으로는 정상 운행을 판단하지 않는다.
    match = re.search(r"(\d+)\s*분\s*후", message)
    if not match:
        return base
    try:
        seconds = int(str(raw_seconds))
    except (TypeError, ValueError):
        return base
    if seconds <= 0 or seconds > 86400:
        return base
    if abs(seconds - int(match.group(1)) * 60) > 120:
        return {**base, "status": "inconsistent"}
    return {**base, "status": "timed", "seconds": seconds,
            "arrival_at_ms": observed_at_ms + seconds * 1000}


def normalize_arrivals(raw, observed_at_ms, received_at_ms):
    records = []
    for item in raw.get("arrivals", []):
        if not isinstance(item, dict):
            continue
        records.append({
            "station_id": str(item.get("stId") or ""),
            "station_name": str(item.get("stNm") or ""),
            "ars_id": str(item.get("arsId") or raw.get("ars_id") or ""),
            "route_id": str(item.get("busRouteId") or ""),
            "route_name": str(item.get("rtNm") or ""),
            "station_order": str(item.get("staOrd") or ""),
            "direction": str(item.get("adirection") or ""),
            "next_stop": str(item.get("nxtStn") or ""),
            "arrivals": [arrival_status(item.get(f"arrmsg{i}"), item.get(f"traTime{i}"), observed_at_ms)
                         for i in (1, 2)],
        })
    return {"ars_id": raw.get("ars_id"), "observed_at_ms": observed_at_ms,
            "received_at_ms": received_at_ms, "max_age_seconds": 60,
            "note": "서버 요청 시작 시각을 기준으로 한 예상치이며 제공기관 생성시각은 확인되지 않습니다.",
            "records": records}
