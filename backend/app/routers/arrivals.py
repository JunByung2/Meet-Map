"""
GET /groups/{group_id}/location/arrivals : Meet Mode 도착 현황

- 지금 시각 기준으로 가까운 확정 약속 하나를 고른다. (약속 3시간 전 ~ 시작 2시간 뒤)
- 그룹 멤버마다 상태를 돌려준다: arrived(도착) / moving(이동 중) / not_sharing(공유 안 함)
  약속 장소의 좌표를 알 수 없으면 공유 중인 사람은 sharing 으로만 표시한다.

접근통제: require_group_member (로그인 안 함 401 / 그룹 멤버 아님 403)

개인정보 규칙
- 위치를 공유하지 않은 사람은 상태만 돌려주고 좌표·거리는 포함하지 않는다.
- 공유 중인 사람도 좌표는 주지 않고, 약속 장소까지의 거리를 100m 단위로만 준다.
- 도착 여부는 저장하지 않는다. 공유가 끝나면 not_sharing 으로 돌아간다.
"""
import math
import time
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.deps.auth import get_current_user, require_group_member
from app.geo import _kakao_get
from app.models import GroupMember, Meeting, User
from app.routers.location import LocationShare

router = APIRouter(prefix="/groups/{group_id}/location", tags=["arrivals"])

MEET_BEFORE_MIN = 180   # 약속 3시간 전부터 Meet Mode 안내
MEET_AFTER_MIN = 120    # 약속 시작 후 2시간까지
ARRIVE_METERS = 400     # 장소까지 이 거리 이하면 도착 (위치가 500m 격자라 오차가 있다)
DISTANCE_STEP = 100     # 거리는 100m 단위로만 알려 준다
PLACE_OK_TTL = 24 * 3600
PLACE_FAIL_TTL = 60

_place_cache: dict[str, tuple[tuple[float, float] | None, float]] = {}


class MeetingBrief(BaseModel):
    id: int
    title: str
    location: str
    meeting_time: datetime


class ArrivalMember(BaseModel):
    user_id: int
    nickname: str | None
    status: Literal["arrived", "moving", "sharing", "not_sharing"]
    distance_m: int | None = None   # 공유 중이고 장소 좌표를 알 때만
    mine: bool


class ArrivalSummary(BaseModel):
    arrived: int = 0
    moving: int = 0
    sharing: int = 0
    not_sharing: int = 0


class ArrivalsOut(BaseModel):
    meeting: MeetingBrief | None
    destination_known: bool
    arrive_meters: int
    summary: ArrivalSummary
    members: list[ArrivalMember]


def _distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """두 좌표 사이 거리(m)."""
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _place_coords(name: str) -> tuple[float, float] | None:
    """장소 이름으로 카카오 검색해서 좌표를 얻는다. (좌표가 저장되지 않은 약속용)"""
    key = name.strip()
    if not key:
        return None
    hit = _place_cache.get(key)
    if hit and hit[1] > time.time():
        return hit[0]

    result = None
    data = _kakao_get("search/keyword.json", {"query": key, "size": 1})
    if data and data.get("documents"):
        doc = data["documents"][0]
        try:
            result = (float(doc["y"]), float(doc["x"]))
        except (KeyError, ValueError):
            result = None

    if len(_place_cache) >= 500:
        _place_cache.clear()
    _place_cache[key] = (result, time.time() + (PLACE_OK_TTL if result else PLACE_FAIL_TTL))
    return result


def _destination(meeting: Meeting) -> tuple[float, float] | None:
    if meeting.place_lat is not None and meeting.place_lng is not None:
        return meeting.place_lat, meeting.place_lng
    return _place_coords(meeting.location)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _current_meeting(db: DbSession, group_id: int, now: datetime) -> Meeting | None:
    """지금 기준 가까운 확정 약속 (약속 3시간 전 ~ 시작 2시간 뒤)."""
    rows = db.scalars(
        select(Meeting).where(
            Meeting.group_id == group_id,
            Meeting.status == "confirmed",
            Meeting.meeting_time >= now - timedelta(minutes=MEET_AFTER_MIN),
            Meeting.meeting_time <= now + timedelta(minutes=MEET_BEFORE_MIN),
        )
    ).all()
    if not rows:
        return None
    return min(rows, key=lambda m: abs(_aware(m.meeting_time) - now))


@router.get("/arrivals", response_model=ArrivalsOut)
def arrivals(
    group_id: int,
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    meeting = _current_meeting(db, group_id, now)
    if meeting is None:
        return ArrivalsOut(
            meeting=None,
            destination_known=False,
            arrive_meters=ARRIVE_METERS,
            summary=ArrivalSummary(),
            members=[],
        )

    dest = _destination(meeting)

    people = db.execute(
        select(GroupMember.user_id, User.nickname)
        .join(User, User.id == GroupMember.user_id)
        .where(GroupMember.group_id == group_id)
        .order_by(GroupMember.user_id)
    ).all()

    # 지금 공유 중인 사람의 대략적인 위치 (좌표는 응답에 넣지 않고 거리 계산에만 쓴다)
    shares = {
        s.user_id: s
        for s in db.scalars(
            select(LocationShare).where(
                LocationShare.group_id == group_id,
                LocationShare.stopped_at.is_(None),
                LocationShare.expires_at > now,
                LocationShare.cell_lat.is_not(None),
                LocationShare.cell_lng.is_not(None),
            )
        ).all()
    }

    counts = {"arrived": 0, "moving": 0, "sharing": 0, "not_sharing": 0}
    members: list[ArrivalMember] = []
    for uid, nickname in people:
        share = shares.get(uid)
        distance = None
        if share is None:
            status = "not_sharing"
        elif dest is None:
            status = "sharing"
        else:
            meters = _distance_m(share.cell_lat, share.cell_lng, dest[0], dest[1])
            distance = int(round(meters / DISTANCE_STEP)) * DISTANCE_STEP
            status = "arrived" if meters <= ARRIVE_METERS else "moving"
        counts[status] += 1
        members.append(
            ArrivalMember(
                user_id=uid,
                nickname=nickname,
                status=status,
                distance_m=distance,
                mine=uid == user.id,
            )
        )

    return ArrivalsOut(
        meeting=MeetingBrief(
            id=meeting.id,
            title=meeting.title,
            location=meeting.location,
            meeting_time=meeting.meeting_time,
        ),
        destination_known=dest is not None,
        arrive_meters=ARRIVE_METERS,
        summary=ArrivalSummary(**counts),
        members=members,
    )