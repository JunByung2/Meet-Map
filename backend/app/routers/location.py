"""
POST   /groups/{group_id}/location/share : 내 위치 공유 시작 (동의한 뒤 호출, 10분)
PUT    /groups/{group_id}/location       : 공유 중인 내 위치 갱신 (만료 시간은 늘어나지 않는다)
DELETE /groups/{group_id}/location       : 공유 중단 (좌표를 바로 지우고 stopped_at 을 기록)
GET    /groups/{group_id}/location       : 지금 공유 중인 그룹 친구들의 대략적인 위치

접근통제: 모든 API 가 require_group_member 를 거친다. (로그인 안 함 401 / 그룹 멤버 아님 403)

개인정보 규칙
- 클라이언트가 보낸 정확한 좌표는 서버가 약 500m 격자의 중심값으로 바꿔서 저장하고 응답한다.
  (정확한 원본 좌표는 저장하지 않는다)
- 공유 중이 아닌 사람(중단·만료·공유한 적 없음)의 좌표는 응답에 포함하지 않는다.
- 중단하면 좌표를 즉시 지우고, 만료·중단된 행은 정리 작업(main.py)이 삭제한다.
- 그룹을 나간 사람의 위치는 목록에서 제외한다.
"""
import math
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, String, delete, or_, select
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.orm import Session as DbSession

from app.db import Base, get_db
from app.deps.auth import get_current_user, require_group_member
from app.models import GroupMember, User

router = APIRouter(prefix="/groups/{group_id}/location", tags=["location"])

SHARE_MINUTES = 10          # ten_min 모드 유지 시간
MIN_UPDATE_SECONDS = 10     # 너무 잦은 갱신 요청은 막는다
LAT_STEP = 0.0045           # 위도 약 500m
LNG_STEP = 0.0057           # 경도 약 500m (서울 위도 기준)


def snap_to_grid(lat: float, lng: float) -> tuple[float, float]:
    """정확한 좌표를 500m 격자 칸의 중심 좌표로 바꾼다."""
    cell_lat = (math.floor(lat / LAT_STEP) + 0.5) * LAT_STEP
    cell_lng = (math.floor(lng / LNG_STEP) + 0.5) * LNG_STEP
    return round(cell_lat, 6), round(cell_lng, 6)


class LocationShare(Base):
    __tablename__ = "location_shares"

    group_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    mode: Mapped[str] = mapped_column(String(10), nullable=False)  # 지금은 ten_min 만
    cell_lat: Mapped[float | None] = mapped_column(Float(53))      # 격자 중심 (중단되면 비움)
    cell_lng: Mapped[float | None] = mapped_column(Float(53))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ShareIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    mode: Literal["ten_min"] = "ten_min"


class PositionIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class LocationOut(BaseModel):
    user_id: int
    nickname: str | None
    lat: float          # 격자 중심 (대략적인 위치)
    lng: float
    updated_at: datetime
    expires_at: datetime
    mine: bool


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _purge(db: DbSession) -> None:
    """만료됐거나 중단된 행을 지운다."""
    db.execute(
        delete(LocationShare).where(
            or_(LocationShare.expires_at <= _now(), LocationShare.stopped_at.is_not(None))
        )
    )


def _out(share: LocationShare, nickname: str | None, me_id: int) -> LocationOut:
    return LocationOut(
        user_id=share.user_id,
        nickname=nickname,
        lat=share.cell_lat,
        lng=share.cell_lng,
        updated_at=share.updated_at,
        expires_at=share.expires_at,
        mine=share.user_id == me_id,
    )


@router.get("", response_model=list[LocationOut])
def list_locations(
    group_id: int,
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    _purge(db)
    db.commit()
    rows = db.execute(
        select(LocationShare, User.nickname)
        .join(User, User.id == LocationShare.user_id)
        # 지금도 이 그룹의 멤버인 사람의 위치만
        .join(
            GroupMember,
            (GroupMember.group_id == LocationShare.group_id)
            & (GroupMember.user_id == LocationShare.user_id),
        )
        .where(
            LocationShare.group_id == group_id,
            LocationShare.stopped_at.is_(None),
            LocationShare.expires_at > _now(),
            LocationShare.cell_lat.is_not(None),
            LocationShare.cell_lng.is_not(None),
        )
        .order_by(LocationShare.updated_at.desc())
    ).all()
    return [_out(s, nick, user.id) for s, nick in rows]


@router.post("/share", response_model=LocationOut, status_code=status.HTTP_201_CREATED)
def start_sharing(
    group_id: int,
    body: ShareIn,
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    _purge(db)
    now = _now()
    cell_lat, cell_lng = snap_to_grid(body.lat, body.lng)  # 정확한 좌표는 여기서 버린다
    share = db.get(LocationShare, (group_id, user.id))
    if share is None:
        share = LocationShare(group_id=group_id, user_id=user.id)
        db.add(share)
    share.mode = body.mode
    share.cell_lat = cell_lat
    share.cell_lng = cell_lng
    share.started_at = now
    share.updated_at = now
    share.expires_at = now + timedelta(minutes=SHARE_MINUTES)
    share.stopped_at = None
    db.commit()
    db.refresh(share)
    return _out(share, user.nickname, user.id)


@router.put("", response_model=LocationOut)
def update_position(
    group_id: int,
    body: PositionIn,
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    now = _now()
    share = db.get(LocationShare, (group_id, user.id))
    if share is None or share.stopped_at is not None or share.expires_at <= now:
        raise HTTPException(status.HTTP_409_CONFLICT, "공유 중이 아니에요. 먼저 공유를 시작해 주세요.")
    if (now - share.updated_at).total_seconds() < MIN_UPDATE_SECONDS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "위치를 너무 자주 보내고 있어요.")
    share.cell_lat, share.cell_lng = snap_to_grid(body.lat, body.lng)
    share.updated_at = now
    db.commit()
    db.refresh(share)
    return _out(share, user.nickname, user.id)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def stop_sharing(
    group_id: int,
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    share = db.get(LocationShare, (group_id, user.id))
    if share is not None:
        share.stopped_at = _now()
        share.cell_lat = None  # 좌표는 즉시 지운다
        share.cell_lng = None
        db.commit()