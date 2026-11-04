"""
약속 기록 API (그룹 멤버만 접근 가능)

GET    /groups/{group_id}/records                     : 기록 목록 (확정된 약속마다 기록이 자동으로 만들어진 뒤, 날짜 최신순)
POST   /groups/{group_id}/records                     : 기록 직접 남기기 (예전 방식, 화면에서는 쓰지 않음)
GET    /groups/{group_id}/records/{record_id}         : 기록 한 건 + 그 기록의 사진
PATCH  /groups/{group_id}/records/{record_id}         : 약속 이름 / 한 줄 문구 수정
POST   /groups/{group_id}/records/{record_id}/photos  : 기록에 사진 더하기
DELETE /groups/{group_id}/records/{record_id}         : 기록 삭제 (사진은 사진 모음에 그대로 남는다)

접근통제: 모든 API 가 require_group_member 를 거친다. (로그인 안 함 401 / 그룹 멤버 아님 403)
자동으로 만들어진 기록은 그룹 멤버 누구나 문구를 고칠 수 있고, 직접 남긴 기록은 기록한 사람 또는 방장만 고칠 수 있다.
사진 검사(확장자·크기·매직 넘버)와 저장은 사진 API 와 똑같은 규칙을 쓴다.
"""
import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session as DbSession

from app import storage
from app.config import PHOTO_MAX_BYTES, PHOTO_MAX_FILES
from app.db import get_db
from app.deps.auth import get_current_user, require_group_member
from app.models import ChatAttachment, GroupMember, MeetingRecord, Photo, User
from app.records_sync import load_confirmed_meetings, sync_group_records, to_kst_date
from app.routers.photos import (
    ALLOWED_EXTENSIONS,
    CONTENT_TYPES,
    PhotoOut,
    PlaceIn,
    _extension,
    _looks_like_image,
    _parse_place,
    _place_columns,
    _require_storage,
    _storage_call,
    _to_out,
)

router = APIRouter(prefix="/groups/{group_id}/records", tags=["records"])



# ---------- 응답/요청 모델 ----------
class RecordOut(BaseModel):
    id: int
    group_id: int
    title: str
    meet_date: date
    meeting_id: int | None
    place_id: str | None
    place_name: str | None
    place_address: str | None
    place_lat: float | None
    place_lng: float | None
    note: str | None
    created_by: int | None
    creator_nickname: str | None
    photo_count: int
    cover_url: str | None  # 대표 사진의 30분짜리 임시 주소 (사진이 없으면 None)
    created_at: datetime
    can_edit: bool


class RecordDetailOut(BaseModel):
    record: RecordOut
    photos: list[PhotoOut]


class RecordPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=60)
    note: str | None = Field(default=None, max_length=100)


# ---------- 도우미 ----------
def _can_edit(record: MeetingRecord, user: User, member: GroupMember) -> bool:
    # 자동으로 만들어진 기록(created_by 없음)은 그 그룹 멤버 누구나 고칠 수 있다
    return record.created_by is None or record.created_by == user.id or member.role == "owner"


def _get_record(db: DbSession, group_id: int, record_id: int) -> MeetingRecord:
    record = db.get(MeetingRecord, record_id)
    # 다른 그룹의 기록 번호를 넣어도 '없음'으로 응답해서 존재 여부가 드러나지 않게 한다.
    if record is None or record.group_id != group_id or record.deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "기록을 찾을 수 없습니다.")
    return record


def _chat_photos_by_day(db: DbSession, group_id: int) -> dict[date, list[Photo]]:
    """지난 기록의 사진 = 그날(한국 시간) 채팅으로 보낸 사진. 채팅에서 사진을 보내지 않으면 기록에도 사진이 없다."""
    chat_paths = select(ChatAttachment.storage_path).where(ChatAttachment.group_id == group_id, ChatAttachment.kind == "image")
    rows = db.execute(
        select(Photo)
        .where(Photo.group_id == group_id, or_(Photo.storage_path.in_(chat_paths), Photo.title == "채팅 사진"))
        .order_by(Photo.created_at, Photo.sort_order, Photo.id)
        .limit(3000)
    ).scalars().all()
    out: dict[date, list[Photo]] = {}
    for p in rows:
        day = to_kst_date(p.created_at)
        if day is not None:
            out.setdefault(day, []).append(p)
    return out


def _to_record_out(
    db: DbSession, records: list[MeetingRecord], user: User, member: GroupMember, with_cover: bool = True
) -> list[RecordOut]:
    if not records:
        return []

    # 기록한 사람 닉네임
    creator_ids = {r.created_by for r in records if r.created_by is not None}
    nicknames = (
        dict(db.execute(select(User.id, User.nickname).where(User.id.in_(creator_ids))).all()) if creator_ids else {}
    )

    # 사진 수 + 대표 사진 (그날 채팅으로 보낸 사진 중 가장 먼저 보낸 것)
    by_day = _chat_photos_by_day(db, records[0].group_id)
    counts = {r.id: len(by_day.get(r.meet_date, [])) for r in records}
    cover_path: dict[int, str] = {r.id: by_day[r.meet_date][0].storage_path for r in records if by_day.get(r.meet_date)}
    urls: dict[str, str] = {}
    if with_cover and cover_path and storage.is_configured():
        try:
            urls = storage.signed_urls(list(cover_path.values()))
        except storage.StorageError:
            urls = {}  # 대표 사진을 못 불러와도 기록 목록은 보여준다

    return [
        RecordOut(
            id=r.id,
            group_id=r.group_id,
            title=r.title,
            meet_date=r.meet_date,
            meeting_id=r.meeting_id,
            place_id=r.place_id,
            place_name=r.place_name,
            place_address=r.place_address,
            place_lat=r.place_lat,
            place_lng=r.place_lng,
            note=r.note,
            created_by=r.created_by,
            creator_nickname=nicknames.get(r.created_by),
            photo_count=counts.get(r.id, 0),
            cover_url=urls.get(cover_path.get(r.id, "")),
            created_at=r.created_at,
            can_edit=_can_edit(r, user, member),
        )
        for r in records
    ]


def _prepare_files(files: list[UploadFile]) -> list[tuple[str, bytes, str]]:
    """저장소에 올리기 전에 전부 검사한다 (하나라도 문제면 아무것도 올리지 않음). 사진 API 와 같은 규칙."""
    if len(files) > PHOTO_MAX_FILES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"한 번에 최대 {PHOTO_MAX_FILES}장까지 올릴 수 있어요.")
    prepared: list[tuple[str, bytes, str]] = []
    for f in files:
        ext = _extension(f.filename)
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "JPG, PNG, WEBP, HEIC 사진만 올릴 수 있어요.")
        data = f.file.read(PHOTO_MAX_BYTES + 1)
        if len(data) > PHOTO_MAX_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "사진 한 장은 20MB 이하여야 해요.")
        if not _looks_like_image(ext, data[:16]):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "사진 파일이 아니거나 손상된 파일이에요.")
        prepared.append((ext, data, CONTENT_TYPES[ext]))
    return prepared


def _store_photos(
    db: DbSession,
    record: MeetingRecord,
    user: User,
    prepared: list[tuple[str, bytes, str]],
    uploaded: list[str],
) -> list[Photo]:
    """검사를 마친 사진을 저장소에 올리고 Photo 행을 만든다. 기록의 제목·문구·장소가 사진에도 같이 저장돼 갤러리·추억지도에 그대로 보인다."""
    batch_id = str(uuid.uuid4())
    place = (
        PlaceIn(
            id=record.place_id,
            name=record.place_name,
            address=record.place_address,
            lat=record.place_lat,
            lng=record.place_lng,
        )
        if record.place_name and record.place_lat is not None and record.place_lng is not None
        else None
    )
    rows: list[Photo] = []
    for index, (ext, data, content_type) in enumerate(prepared):
        path = f"groups/{record.group_id}/photos/{uuid.uuid4()}/original.{ext}"
        _storage_call(storage.upload, path, data, content_type)
        uploaded.append(path)
        rows.append(
            Photo(
                group_id=record.group_id,
                user_id=user.id,
                record_id=record.id,
                storage_path=path,
                url=storage.public_style_url(path),
                title=record.title,
                memo=record.note,
                batch_id=batch_id,
                sort_order=index,
                **_place_columns(place),
            )
        )
    db.add_all(rows)
    return rows


# ---------- API ----------
@router.get("", response_model=list[RecordOut])
def list_records(
    group_id: int,
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    sync_group_records(db, group_id)  # 확정된 약속 중 기록이 없는 것을 자동으로 만든다
    rows = db.execute(
        select(MeetingRecord)
        .where(MeetingRecord.group_id == group_id, MeetingRecord.deleted.is_(False))
        .order_by(MeetingRecord.meet_date.desc(), MeetingRecord.id.desc())
        .limit(500)
    ).scalars().all()
    return _to_record_out(db, list(rows), user, member)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=RecordDetailOut)
def create_record(
    group_id: int,
    title: str = Form(...),
    meet_date: date = Form(...),
    note: str = Form(default=""),
    meeting_id: int | None = Form(default=None),
    place_id: str | None = Form(default=None),
    place_name: str | None = Form(default=None),
    place_address: str | None = Form(default=None),
    place_lat: float | None = Form(default=None),
    place_lng: float | None = Form(default=None),
    files: list[UploadFile] = File(default=[]),
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    title, note = title.strip(), note.strip()
    if not title or len(title) > 60:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "약속 이름은 1~60자로 적어 주세요.")
    if len(note) > 100:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "한 줄 문구는 100자까지 쓸 수 있어요.")
    place = _parse_place(place_id, place_name, place_address, place_lat, place_lng)
    if meeting_id is not None and db.scalar(
        select(MeetingRecord.id).where(MeetingRecord.group_id == group_id, MeetingRecord.meeting_id == meeting_id)
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "이 약속은 이미 기록이 있어요. 기존 기록에 사진을 더해 주세요.")
    files = [f for f in files if f.filename]  # 사진을 안 골랐을 때 오는 빈 항목은 건너뛴다
    if files:
        _require_storage()
    prepared = _prepare_files(files)

    uploaded: list[str] = []
    try:
        record = MeetingRecord(
            group_id=group_id,
            created_by=user.id,
            meeting_id=meeting_id,
            title=title,
            meet_date=meet_date,
            note=note or None,
            **{k: v for k, v in _place_columns(place).items()},
        )
        db.add(record)
        db.flush()  # record.id 를 받는다
        if prepared:
            _store_photos(db, record, user, prepared, uploaded)
        db.commit()
    except Exception:
        db.rollback()
        try:
            storage.remove(uploaded)  # 반쪽짜리 기록이 남지 않게, 올라간 사진을 지운다
        except storage.StorageError:
            pass
        raise
    return _detail(db, record, user, member)


def _detail(db: DbSession, record: MeetingRecord, user: User, member: GroupMember) -> RecordDetailOut:
    photos = _chat_photos_by_day(db, record.group_id).get(record.meet_date, [])
    out_record = _to_record_out(db, [record], user, member, with_cover=False)[0]
    out_photos = _to_out(db, list(photos), user, member) if photos and storage.is_configured() else []
    if out_photos:
        out_record.cover_url = out_photos[0].signed_url
    return RecordDetailOut(record=out_record, photos=out_photos)


@router.get("/{record_id}", response_model=RecordDetailOut)
def record_detail(
    group_id: int,
    record_id: int,
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    record = _get_record(db, group_id, record_id)
    return _detail(db, record, user, member)


@router.patch("/{record_id}", response_model=RecordOut)
def update_record(
    group_id: int,
    record_id: int,
    body: RecordPatch,
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    record = _get_record(db, group_id, record_id)
    if not _can_edit(record, user, member):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "기록한 사람이나 방장만 수정할 수 있어요.")
    fields = body.model_dump(exclude_unset=True)
    if "title" in fields and fields["title"] is not None:
        title = fields["title"].strip()
        if not title:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "약속 이름은 비울 수 없어요.")
        record.title = title
    if "note" in fields:
        record.note = (fields["note"] or "").strip() or None
    db.commit()
    return _to_record_out(db, [record], user, member)[0]


@router.post("/{record_id}/photos", response_model=RecordDetailOut, status_code=status.HTTP_201_CREATED)
def add_photos(
    group_id: int,
    record_id: int,
    files: list[UploadFile] = File(...),
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    _require_storage()
    record = _get_record(db, group_id, record_id)
    files = [f for f in files if f.filename]
    if not files:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "업로드할 사진을 선택해 주세요.")
    prepared = _prepare_files(files)
    uploaded: list[str] = []
    try:
        _store_photos(db, record, user, prepared, uploaded)
        db.commit()
    except Exception:
        db.rollback()
        try:
            storage.remove(uploaded)
        except storage.StorageError:
            pass
        raise
    return _detail(db, record, user, member)


@router.delete("/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_record(
    group_id: int,
    record_id: int,
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    record = _get_record(db, group_id, record_id)
    if not _can_edit(record, user, member):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "기록한 사람이나 방장만 삭제할 수 있어요.")
    # 사진은 지우지 않는다. 사진 모음과 추억지도에는 그대로 남고, 이 기록과의 연결만 끊긴다.
    db.execute(text("UPDATE group_photos SET record_id = NULL WHERE record_id = :r"), {"r": record.id})
    if record.meeting_id is not None:
        # 약속에서 만들어진 기록은 흔적만 남겨 둔다. (지우면 목록을 열 때 다시 자동으로 만들어지기 때문)
        record.deleted = True
    else:
        db.delete(record)
    db.commit()
