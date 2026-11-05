"""후보 선별용 예상시간과 검증된 시간의 짧은 캐시. 예상치는 최종 결과에 반환하지 않는다."""
import math
import threading
import time
from collections import OrderedDict

TTL = 300
MAX_ENTRIES = 2048
_cache = OrderedDict()
_lock = threading.Lock()
_stripes = [threading.Lock() for _ in range(32)]


def _key(start, end, policy):
    # 방향과 정확한 좌표를 보존한다. 멤버 순서를 바꿔도 경로 단위로 재사용한다.
    return (policy, float(start['x']), float(start['y']), float(end['x']), float(end['y']))


def _get(key):
    with _lock:
        entry = _cache.get(key)
        if entry is None:
            return None
        if time.monotonic() >= entry[0]:
            del _cache[key]
            return None
        _cache.move_to_end(key)
        return entry[1]


def verified_seconds(start, end, policy, fetch):
    key = _key(start, end, policy)
    # 동일 구간 동시 요청을 묶는다. 실패는 저장하지 않는다.
    with _stripes[hash(key) % len(_stripes)]:
        cached = _get(key)
        if cached is not None:
            return cached
        seconds = fetch()
        if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or seconds < 0:
            from meeting_tools.transit.kakao_route import TransitError
            raise TransitError('경로의 이동시간 정보가 올바르지 않습니다.')
        with _lock:
            _cache[key] = (time.monotonic() + TTL, seconds)
            _cache.move_to_end(key)
            while len(_cache) > MAX_ENTRIES:
                _cache.popitem(last=False)
        return seconds


def estimate(start, end, hubs, distance, policy):
    cached = _get(_key(start, end, policy))
    if cached is not None:
        return cached
    km = distance(start, end)
    if km < 0.05:
        return 0.0
    # 아래 속도/대기는 후보 선별을 위한 가정이며 시간표나 실제 버스시간이 아니다.
    local = lambda d: d / 25 * 3600 + (300 if d > 0.5 else 0)
    if km < 60:
        return local(km)
    options = []
    for mode in ('TRAIN', 'EXPRESSBUS', 'INTERCITY'):
        subset = [h for h in hubs if h['mode'] == mode]
        starts = sorted(subset, key=lambda h: distance(start, h))[:2]
        ends = sorted(subset, key=lambda h: distance(end, h))[:2]
        for a in starts:
            for b in ends:
                da, db = distance(start, a), distance(end, b)
                if da > 65 or db > 65 or a is b:
                    continue
                speed = 100 if mode == 'TRAIN' else 65
                options.append(local(da) + distance(a, b) / speed * 3600 + 1200 + local(db))
    # 거점 목록이 부족해도 실제 조회 전 후보를 무조건 탈락시키지는 않는다.
    return min(options) if options else km / 60 * 3600 + 1800


def shortlist(candidates, departures, hubs, distance, policy, limit=5):
    long_distance = any(distance(a, b) >= 100 for a in departures for b in departures)
    if long_distance:
        # 장거리 모임은 도시 내 작은 지하철역보다 여객역/터미널을 먼저 검증한다.
        candidates = [p for p in candidates if p['candidate_type'] in ('train', 'terminal')]
    def score(p):
        times = [estimate(d, p, hubs, distance, policy) for d in departures]
        return (max(times) + .5*(max(times)-min(times)), sum(times)/len(times), p['id'])
    ranked = sorted(candidates, key=score)
    selected = []
    # 같은 동네에 검증 슬롯이 몰리지 않도록 장거리일 때 15km 떨어진 후보를 우선한다.
    for item in ranked:
        if not long_distance or all(distance(item, p) >= 15 for p in selected):
            selected.append(item)
            if len(selected) == limit:
                return selected
    ids = {p['id'] for p in selected}
    selected.extend(p for p in ranked if p['id'] not in ids)
    return selected[:limit]
