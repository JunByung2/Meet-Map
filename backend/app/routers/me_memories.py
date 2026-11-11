"""
내가 속한 모든 그룹의 추억 모아보기 (그룹에 들어가기 전 첫 화면용, 읽기 전용)

GET /me/memories : 내가 속한 그룹들의 사진 · 장소 있는 사진 · 지난 기록을 한 번에 돌려준다.

접근통제: 로그인 필수(get_current_user). 내가 멤버인 그룹의 자료만 읽는다. (group_members 로 걸러냄)
사진 주소는 30분짜리 임시 주소이고, 저장소 설정이 없거나 실패해도 목록 자체는 돌려준다.
"""
from datetime import date, datetime

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy import and_, exists, select
from sqlalchemy.orm import Session as DbSession

from app import storage
from app.db import get_db
from app.deps.auth import get_current_user
from app.models import Group, GroupMember, MeetingRecord, Photo, User
from app.records_sync import KST, sync_group_records
from app.routers.records import _to_record_out

router = APIRouter(prefix="/me", tags=["me"])

PHOTO_LIMIT = 240  # 최근 사진 (사진 탭)
PLACE_LIMIT = 300  # 장소가 있는 사진 (추억지도)
RECORD_LIMIT_PER_GROUP = 60


class MemGroup(BaseModel):
    id: int
    name: str
    icon: str | None


class MemPhoto(BaseModel):
    id: int
    group_id: int
    batch_id: str
    title: str | None
    created_at: datetime
    signed_url: str | None
    place_id: str | None
    place_name: str | None
    place_address: str | None
    place_lat: float | None
    place_lng: float | None


class MemRecord(BaseModel):
    id: int
    group_id: int
    title: str
    meet_date: date
    place_name: str | None
    photo_count: int
    cover_url: str | None


class MemoriesOut(BaseModel):
    groups: list[MemGroup]
    photos: list[MemPhoto]  # 최근 사진
    place_photos: list[MemPhoto]  # 장소가 있는 사진 (지도 핀용)
    records: list[MemRecord]


def _mem_photo(p: Photo, urls: dict[str, str]) -> MemPhoto:
    return MemPhoto(
        id=p.id, group_id=p.group_id, batch_id=p.batch_id, title=p.title, created_at=p.created_at,
        signed_url=urls.get(p.storage_path), place_id=p.place_id, place_name=p.place_name,
        place_address=p.place_address, place_lat=p.place_lat, place_lng=p.place_lng,
    )


@router.get("/memories", response_model=MemoriesOut)
def my_memories(response: Response, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)):
    response.headers["Cache-Control"] = "private, no-store"
    rows = db.execute(
        select(Group, GroupMember)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.user_id == user.id)
        .order_by(Group.id)
    ).all()
    groups = [g for g, _ in rows]
    members = {g.id: m for g, m in rows}
    if not groups:
        return MemoriesOut(groups=[], photos=[], place_photos=[], records=[])
    group_ids = list(members)

    recent = list(db.execute(
        select(Photo).where(Photo.group_id.in_(group_ids)).order_by(Photo.created_at.desc(), Photo.id.desc()).limit(PHOTO_LIMIT)
    ).scalars())
    placed = list(db.execute(
        select(Photo)
        .where(Photo.group_id.in_(group_ids), Photo.place_lat.is_not(None), Photo.place_lng.is_not(None), Photo.place_name.is_not(None))
        .order_by(Photo.created_at.desc(), Photo.id.desc()).limit(PLACE_LIMIT)
    ).scalars())

    records: list[MemRecord] = []
    today = datetime.now(KST).date()
    for gid in group_ids:
        try:
            sync_group_records(db, gid)
        except Exception:  # 한 그룹의 기록 동기화가 실패해도 나머지는 보여준다
            db.rollback()
        not_yet = and_(
            MeetingRecord.meeting_id.is_not(None), MeetingRecord.created_by.is_(None),
            MeetingRecord.meet_date >= today, ~exists().where(Photo.record_id == MeetingRecord.id),
        )
        recs = list(db.execute(
            select(MeetingRecord)
            .where(MeetingRecord.group_id == gid, MeetingRecord.deleted.is_(False), ~not_yet)
            .order_by(MeetingRecord.meet_date.desc(), MeetingRecord.id.desc()).limit(RECORD_LIMIT_PER_GROUP)
        ).scalars())
        for r in _to_record_out(db, recs, user, members[gid]):
            records.append(MemRecord(
                id=r.id, group_id=r.group_id, title=r.title, meet_date=r.meet_date, place_name=r.place_name,
                photo_count=r.photo_count, cover_url=r.cover_url,
            ))
    records.sort(key=lambda r: (r.meet_date, r.id), reverse=True)

    urls: dict[str, str] = {}
    paths = list(dict.fromkeys(p.storage_path for p in recent + placed))
    if paths and storage.is_configured():
        try:
            urls = storage.signed_urls(paths)
        except storage.StorageError:
            urls = {}

    return MemoriesOut(
        groups=[MemGroup(id=g.id, name=g.name, icon=g.icon) for g in groups],
        photos=[_mem_photo(p, urls) for p in recent],
        place_photos=[_mem_photo(p, urls) for p in placed],
        records=records,
    )
