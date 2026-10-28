"""
채팅 사진 / 파일 첨부 API (그룹 멤버만 접근 가능)

POST /groups/{group_id}/chat-files                    : 사진 또는 파일 올리기 (kind=image | file) → 번호를 돌려준다
GET  /groups/{group_id}/chat-files/{id}               : 정보 (사진이면 30분짜리 임시 주소 포함)
GET  /groups/{group_id}/chat-files/{id}/download      : 내려받기 (서버가 저장소에서 받아 attachment 로 내려준다)

채팅 메시지에는 글 마지막 줄에 `attach:번호` 만 적는다. (messages 표는 바꾸지 않는다)
- 사진(image): 사진 모음(group_photos)에도 같이 등록돼서 사진 페이지·약속 기록에 자동으로 보인다.
- 파일(file): 허용 확장자만 받는다. 실행 파일·스크립트·HTML 등은 받지 않는다. 확장자와 파일 앞 바이트도 확인한다.
접근통제: 모든 API 가 require_group_member 를 거친다. 다른 그룹의 번호는 '없음'(404)으로 응답한다.
"""
import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app import storage
from app.config import PHOTO_MAX_BYTES
from app.db import get_db
from app.deps.auth import get_current_user, require_group_member
from app.models import ChatAttachment, GroupMember, Photo, User
from app.records_sync import auto_link_photos
from app.routers.photos import (
    ALLOWED_EXTENSIONS as IMAGE_EXTENSIONS,
    CONTENT_TYPES as IMAGE_TYPES,
    _extension,
    _looks_like_image,
    _place_columns,
    _require_storage,
    _storage_call,
)

router = APIRouter(prefix="/groups/{group_id}/chat-files", tags=["chat-files"])

# 문서/압축 파일만 허용 (실행 파일, 스크립트, html, svg 등은 받지 않는다)
FILE_TYPES = {
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "hwp": "application/x-hwp",
    "hwpx": "application/octet-stream",
    "txt": "text/plain; charset=utf-8",
    "csv": "text/csv; charset=utf-8",
    "md": "text/plain; charset=utf-8",
    "zip": "application/zip",
}
ZIP_LIKE = {"docx", "xlsx", "pptx", "hwpx", "zip"}
OLE_LIKE = {"doc", "xls", "ppt", "hwp"}
TEXT_LIKE = {"txt", "csv", "md"}
FILE_MAX_BYTES = 10 * 1024 * 1024  # 문서 파일은 DB에 저장하므로 10MB까지


class AttachmentOut(BaseModel):
    id: int
    kind: str
    filename: str
    content_type: str
    size: int
    signed_url: str | None  # 사진일 때만 (채팅 안에서 바로 보여 주는 30분짜리 임시 주소)
    uploader_id: int | None


def _clean_name(name: str | None) -> str:
    base = (name or "").replace("\\", "/").rsplit("/", 1)[-1]
    base = "".join(ch for ch in base if ch >= " " and ch not in '<>:"|?*')  # 제어문자·위험 문자 제거
    return (base.strip() or "파일")[:150]


def _looks_like_file(ext: str, head: bytes) -> bool:
    if ext == "pdf":
        return head.startswith(b"%PDF")
    if ext in ZIP_LIKE:
        return head.startswith(b"PK\x03\x04") or head.startswith(b"PK\x05\x06")
    if ext in OLE_LIKE:
        return head.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")
    if ext in TEXT_LIKE:
        return b"\x00" not in head
    return False


def _get(db: DbSession, group_id: int, attachment_id: int) -> ChatAttachment:
    row = db.get(ChatAttachment, attachment_id)
    if row is None or row.group_id != group_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "첨부 파일을 찾을 수 없습니다.")
    return row


def _out(row: ChatAttachment, with_url: bool = True) -> AttachmentOut:
    url = None
    if with_url and row.kind == "image" and storage.is_configured():
        try:
            url = storage.signed_urls([row.storage_path]).get(row.storage_path)
        except storage.StorageError:
            url = None
    return AttachmentOut(
        id=row.id,
        kind=row.kind,
        filename=row.filename,
        content_type=row.content_type,
        size=row.size,
        signed_url=url,
        uploader_id=row.user_id,
    )


@router.post("", status_code=status.HTTP_201_CREATED, response_model=AttachmentOut)
def upload_chat_file(
    group_id: int,
    file: UploadFile = File(...),
    kind: str = Form(...),
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    if kind not in ("image", "file"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "kind 는 image 또는 file 이어야 합니다.")
    if kind == "image":
        _require_storage()  # 사진만 사진 저장소(Supabase)를 쓴다. 문서 파일은 DB 에 저장한다.
    filename = _clean_name(file.filename)
    ext = _extension(filename)
    limit = PHOTO_MAX_BYTES if kind == "image" else FILE_MAX_BYTES
    data = file.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"파일 하나는 {limit // 1024 // 1024}MB 이하여야 해요.")
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "빈 파일은 보낼 수 없어요.")

    if kind == "image":
        if ext not in IMAGE_EXTENSIONS or not _looks_like_image(ext, data[:16]):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "JPG, PNG, WEBP, HEIC 사진만 보낼 수 있어요.")
        content_type = IMAGE_TYPES[ext]
        path = f"groups/{group_id}/photos/{uuid.uuid4()}/original.{ext}"
    else:
        if ext not in FILE_TYPES or not _looks_like_file(ext, data[:16]):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "PDF, 문서(DOC·DOCX·HWP·HWPX), 엑셀, 파워포인트, TXT·CSV, ZIP 파일만 보낼 수 있어요.",
            )
        content_type = FILE_TYPES[ext]
        path = f"db:{uuid.uuid4()}"

    if kind == "image":
        _storage_call(storage.upload, path, data, content_type)
    try:
        row = ChatAttachment(
            group_id=group_id,
            user_id=user.id,
            kind=kind,
            filename=filename,
            content_type=content_type,
            size=len(data),
            storage_path=path,
            data=data if kind == "file" else None,
        )
        db.add(row)
        photo = None
        if kind == "image":
            # 채팅으로 보낸 사진은 사진 모음에도 들어간다 (같은 저장 파일을 가리킨다)
            photo = Photo(
                group_id=group_id,
                user_id=user.id,
                storage_path=path,
                url=storage.public_style_url(path),
                title="채팅 사진",
                batch_id=str(uuid.uuid4()),
                sort_order=0,
                **_place_columns(None),
            )
            db.add(photo)
        db.commit()
    except Exception:
        db.rollback()
        if kind == "image":
            try:
                storage.remove([path])
            except storage.StorageError:
                pass
        raise
    if photo is not None:
        auto_link_photos(db, group_id, [photo])  # 오늘 확정된 약속이 하나뿐이면 그 기록에도 붙는다
    return _out(row)


@router.get("/{attachment_id}", response_model=AttachmentOut)
def chat_file_info(
    group_id: int,
    attachment_id: int,
    member: GroupMember = Depends(require_group_member),
    db: DbSession = Depends(get_db),
):
    return _out(_get(db, group_id, attachment_id))


@router.get("/{attachment_id}/download")
def download_chat_file(
    group_id: int,
    attachment_id: int,
    member: GroupMember = Depends(require_group_member),
    db: DbSession = Depends(get_db),
):
    row = _get(db, group_id, attachment_id)
    if row.storage_path.startswith("db:"):
        data = row.data or b""
    else:  # 예전에 저장소에 올린 파일
        _require_storage()
        data, _ = _storage_call(storage.download, row.storage_path)
    # 항상 '내려받기'로만 내려준다 (브라우저가 열어서 실행하지 않게). 한글 이름은 RFC 5987 로 인코딩.
    disposition = f"attachment; filename*=UTF-8''{quote(row.filename, safe='')}"
    return Response(
        content=data,
        media_type=row.content_type.split(";")[0],
        headers={
            "Content-Disposition": disposition,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )
