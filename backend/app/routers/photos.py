"""
그룹 사진 API (그룹 멤버만 접근 가능)

GET    /groups/{group_id}/photos                      : 그룹 사진 목록 (최신순, 임시 주소 포함)
POST   /groups/{group_id}/photos                      : 사진 올리기 (여러 장 한 번에 = 한 묶음)
GET    /groups/{group_id}/photos/{photo_id}           : 사진 한 장 + 같이 올린 묶음
PATCH  /groups/{group_id}/photos/{photo_id}           : 사진 설명(caption) 수정
PATCH  /groups/{group_id}/photos/batch/{batch_id}     : 묶음의 제목/메모/장소 수정
DELETE /groups/{group_id}/photos/batch/{batch_id}     : 묶음 삭제 (파일 + 기록)

접근통제: 모든 API 가 require_group_member 를 거친다. (로그인 안 함 401 / 그룹 멤버 아님 403)
수정·삭제는 올린 사람 또는 방장만 할 수 있다.
"""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app import storage
from app.config import PHOTO_MAX_BYTES, PHOTO_MAX_FILES
from app.db import get_db
from app.deps.auth import get_current_user, require_group_member
from app.models import GroupMember, Photo, User

router = APIRouter(prefix="/groups/{group_id}/photos", tags=["photos"])

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "heic"}
CONTENT_TYPES = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp", "heic": "image/heic"}
LIST_LIMIT = 500


# ---------- 응답/요청 모델 ----------
class PhotoOut(BaseModel):
    id: int
    group_id: int
    user_id: int | None
    uploader_nickname: str | None
    storage_path: str
    url: str | None
    caption: str | None
    title: str | None
    memo: str | None
    batch_id: str
    sort_order: int
    place_id: str | None        # 카카오 장소 id
    place_name: str | None      # 찍은 장소 (추억지도 마커)
    place_address: str | None
    place_lat: float | None
    place_lng: float | None
    created_at: datetime
    signed_url: str | None  # 30분짜리 임시 주소 (비공개 버킷이라 이 주소로만 보인다)
    can_edit: bool          # 내가 수정/삭제할 수 있는 사진인지


class PhotoDetailOut(BaseModel):
    photo: PhotoOut
    batch: list[PhotoOut]


class CaptionIn(BaseModel):
    caption: str | None = Field(default=None, max_length=200)


class PlaceIn(BaseModel):
    id: str | None = Field(default=None, max_length=40)
    name: str = Field(min_length=1, max_length=100)
    address: str | None = Field(default=None, max_length=200)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class RecordIn(BaseModel):
    title: str | None = Field(default=None, max_length=60)
    memo: str | None = Field(default=None, max_length=500)
    place: PlaceIn | None = None  # None 이면 장소 없음(지정했던 장소도 해제)


# ---------- 도우미 ----------
def _require_storage() -> None:
    if not storage.is_configured():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "사진 저장소(Supabase)가 아직 설정되지 않았어요. backend/.env 의 SUPABASE_URL, SUPABASE_SERVICE_KEY 를 확인해 주세요.",
        )


def _storage_call(fn, *args):
    try:
        return fn(*args)
    except storage.StorageError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"사진 저장소 오류: {e}") from e


def _extension(filename: str | None) -> str:
    ext = (filename or "").rsplit(".", 1)[-1].lower() if "." in (filename or "") else ""
    return "jpg" if ext == "jpeg" else ext


def _looks_like_image(ext: str, head: bytes) -> bool:
    """확장자만 바꾼 가짜 파일을 거르기 위해 파일 맨 앞 바이트(매직 넘버)도 확인한다."""
    if ext == "jpg":
        return head.startswith(b"\xff\xd8\xff")
    if ext == "png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if ext == "webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if ext == "heic":
        return head[4:8] == b"ftyp"
    return False


def _can_edit(photo: Photo, user: User, member: GroupMember) -> bool:
    return photo.user_id == user.id or member.role == "owner"


def _to_out(db: DbSession, photos: list[Photo], user: User, member: GroupMember) -> list[PhotoOut]:
    urls = _storage_call(storage.signed_urls, [p.storage_path for p in photos]) if photos else {}
    user_ids = {p.user_id for p in photos if p.user_id is not None}
    nicknames = (
        dict(db.execute(select(User.id, User.nickname).where(User.id.in_(user_ids))).all()) if user_ids else {}
    )
    return [
        PhotoOut(
            id=p.id,
            group_id=p.group_id,
            user_id=p.user_id,
            uploader_nickname=nicknames.get(p.user_id),
            storage_path=p.storage_path,
            url=p.url,
            caption=p.caption,
            title=p.title,
            memo=p.memo,
            batch_id=p.batch_id,
            sort_order=p.sort_order,
            place_id=p.place_id,
            place_name=p.place_name,
            place_address=p.place_address,
            place_lat=p.place_lat,
            place_lng=p.place_lng,
            created_at=p.created_at,
            signed_url=urls.get(p.storage_path),
            can_edit=_can_edit(p, user, member),
        )
        for p in photos
    ]


def _parse_place(
    place_id: str | None, name: str | None, address: str | None, lat: float | None, lng: float | None
) -> PlaceIn | None:
    """업로드 폼의 장소 값을 검사한다. 장소를 안 골랐으면 None."""
    if not (name or "").strip() and lat is None and lng is None:
        return None
    try:
        return PlaceIn(
            id=(place_id or "").strip() or None,
            name=(name or "").strip(),
            address=(address or "").strip() or None,
            lat=lat if lat is not None else float("nan"),
            lng=lng if lng is not None else float("nan"),
        )
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "장소 정보가 올바르지 않아요. 장소를 다시 선택해 주세요.")


def _place_columns(place: PlaceIn | None) -> dict:
    if place is None:
        return {"place_id": None, "place_name": None, "place_address": None, "place_lat": None, "place_lng": None}
    return {
        "place_id": place.id,
        "place_name": place.name,
        "place_address": place.address,
        "place_lat": place.lat,
        "place_lng": place.lng,
    }


def _get_photo(db: DbSession, group_id: int, photo_id: int) -> Photo:
    photo = db.get(Photo, photo_id)
    # 다른 그룹의 사진 번호를 넣어도 '없음'으로 응답해서 존재 여부가 드러나지 않게 한다.
    if photo is None or photo.group_id != group_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "사진을 찾을 수 없습니다.")
    return photo


def _get_batch(db: DbSession, group_id: int, batch_id: str) -> list[Photo]:
    rows = db.execute(
        select(Photo).where(Photo.group_id == group_id, Photo.batch_id == batch_id).order_by(Photo.sort_order, Photo.id)
    ).scalars().all()
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "사진을 찾을 수 없습니다.")
    return list(rows)


# ---------- API ----------
@router.get("", response_model=list[PhotoOut])
def list_photos(
    group_id: int,
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    _require_storage()
    rows = db.execute(
        select(Photo).where(Photo.group_id == group_id).order_by(Photo.created_at.desc(), Photo.id.desc()).limit(LIST_LIMIT)
    ).scalars().all()
    return _to_out(db, list(rows), user, member)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=list[PhotoOut])
def upload_photos(
    group_id: int,
    files: list[UploadFile] = File(...),
    captions: list[str] = Form(default=[]),  # files 와 같은 순서 (비어 있어도 됨)
    title: str = Form(default=""),
    memo: str = Form(default=""),
    place_id: str | None = Form(default=None),
    place_name: str | None = Form(default=None),
    place_address: str | None = Form(default=None),
    place_lat: float | None = Form(default=None),
    place_lng: float | None = Form(default=None),
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    _require_storage()
    title, memo = title.strip(), memo.strip()
    place = _parse_place(place_id, place_name, place_address, place_lat, place_lng)
    if len(title) > 60 or len(memo) > 500:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "제목은 60자, 메모는 500자까지 쓸 수 있어요.")
    if not files:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "업로드할 사진을 선택해 주세요.")
    if len(files) > PHOTO_MAX_FILES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"한 번에 최대 {PHOTO_MAX_FILES}장까지 올릴 수 있어요.")
    if any(len(c) > 200 for c in captions):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "사진 설명은 200자까지 쓸 수 있어요.")

    # 1) 저장소에 올리기 전에 전부 검사한다 (하나라도 문제면 아무것도 올리지 않음)
    prepared: list[tuple[str, bytes, str]] = []  # (확장자, 내용, content-type)
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

    # 2) 한 장씩 올리고, 중간에 실패하면 이번에 올린 것을 전부 지운다 (반쪽짜리 묶음 방지)
    batch_id = str(uuid.uuid4())
    uploaded: list[str] = []
    rows: list[Photo] = []
    try:
        for index, (ext, data, content_type) in enumerate(prepared):
            path = f"groups/{group_id}/photos/{uuid.uuid4()}/original.{ext}"
            _storage_call(storage.upload, path, data, content_type)
            uploaded.append(path)
            rows.append(
                Photo(
                    group_id=group_id,
                    user_id=user.id,
                    storage_path=path,
                    url=storage.public_style_url(path),
                    caption=(captions[index].strip() or None) if index < len(captions) else None,
                    title=title or None,
                    memo=memo or None,
                    batch_id=batch_id,
                    sort_order=index,
                    **_place_columns(place),
                )
            )
        db.add_all(rows)
        db.commit()
    except Exception:
        db.rollback()
        try:
            storage.remove(uploaded)
        except storage.StorageError:
            pass
        raise
    for r in rows:
        db.refresh(r)
    return _to_out(db, rows, user, member)


@router.get("/{photo_id}", response_model=PhotoDetailOut)
def photo_detail(
    group_id: int,
    photo_id: int,
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    _require_storage()
    photo = _get_photo(db, group_id, photo_id)
    batch = _get_batch(db, group_id, photo.batch_id)
    out = _to_out(db, batch, user, member)
    return PhotoDetailOut(photo=next(o for o in out if o.id == photo.id), batch=out)


@router.patch("/batch/{batch_id}", response_model=list[PhotoOut])
def update_record(
    group_id: int,
    batch_id: str,
    body: RecordIn,
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    _require_storage()
    batch = _get_batch(db, group_id, batch_id)
    if not all(_can_edit(p, user, member) for p in batch):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "올린 사람이나 방장만 수정할 수 있어요.")
    title = (body.title or "").strip() or None
    memo = (body.memo or "").strip() or None
    for p in batch:
        p.title, p.memo = title, memo
        for column, value in _place_columns(body.place).items():
            setattr(p, column, value)
    db.commit()
    return _to_out(db, batch, user, member)


@router.patch("/{photo_id}", response_model=PhotoOut)
def update_caption(
    group_id: int,
    photo_id: int,
    body: CaptionIn,
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    _require_storage()
    photo = _get_photo(db, group_id, photo_id)
    if not _can_edit(photo, user, member):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "올린 사람이나 방장만 수정할 수 있어요.")
    photo.caption = (body.caption or "").strip() or None
    db.commit()
    return _to_out(db, [photo], user, member)[0]


@router.delete("/batch/{batch_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_batch(
    group_id: int,
    batch_id: str,
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    _require_storage()
    batch = _get_batch(db, group_id, batch_id)
    if not all(_can_edit(p, user, member) for p in batch):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "올린 사람이나 방장만 삭제할 수 있어요.")
    # 파일을 먼저 지우고(실패하면 기록은 그대로 둔다), 성공하면 기록을 지운다
    _storage_call(storage.remove, [p.storage_path for p in batch])
    for p in batch:
        db.delete(p)
    db.commit()
