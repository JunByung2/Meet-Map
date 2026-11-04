"""
프로필 사진 API

POST   /auth/me/avatar          : 내 프로필 사진 올리기 (JPG/PNG/WEBP, 2MB 이하)
DELETE /auth/me/avatar          : 내 프로필 사진 지우기
GET    /profiles/{user_id}/image: 프로필 사진 보기 (본인이거나 같은 그룹 멤버만)

- 파일은 Supabase 비공개 버킷의 profiles/{user_id}/... 경로에 저장한다.
- 올리는 대상은 항상 세션의 본인이다. (요청에서 user_id 를 받지 않는다)
- 파일 종류는 확장자나 Content-Type 이 아니라 파일 앞부분(시그니처)으로 확인한다.
- 소셜 로그인으로 가입한 회원의 사진은 외부 주소(https://...)가 그대로 저장돼 있다.
"""
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession, aliased

from app import storage
from app.db import get_db
from app.deps.auth import get_current_user
from app.models import GroupMember, User
from app.schemas import UserOut

router = APIRouter(tags=["avatar"])

AVATAR_MAX_BYTES = 2 * 1024 * 1024  # 2MB


def _detect_image(data: bytes) -> tuple[str, str] | None:
    """파일 앞부분으로 (확장자, Content-Type) 을 판별한다. 지원하지 않으면 None."""
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg", "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    return None


def remove_own_avatar_file(user_id: int, path: str | None) -> None:
    """우리 저장소에 올린 '내' 프로필 사진 파일이면 지운다. (소셜 사진 주소는 건드리지 않는다)"""
    if path and path.startswith(f"profiles/{user_id}/"):
        try:
            storage.remove([path])
        except storage.StorageError:
            pass  # 파일 정리에 실패해도 사용자 동작은 막지 않는다


def _to_out(user: User) -> UserOut:
    return UserOut(
        id=user.id, nickname=user.nickname, email=user.email, profile_image=user.profile_image
    )


@router.post("/auth/me/avatar", response_model=UserOut)
def upload_avatar(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    if not storage.is_configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "사진 저장소가 아직 설정되지 않았어요.")

    data = file.file.read(AVATAR_MAX_BYTES + 1)
    if len(data) > AVATAR_MAX_BYTES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "프로필 사진은 2MB 이하만 올릴 수 있어요.")
    kind = _detect_image(data)
    if kind is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "JPG, PNG, WEBP 사진만 올릴 수 있어요.")
    ext, content_type = kind

    path = f"profiles/{user.id}/{uuid.uuid4().hex}.{ext}"  # 파일 이름은 서버가 새로 만든다
    try:
        storage.upload(path, data, content_type)
    except storage.StorageError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "사진을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.")

    old = user.profile_image
    user.profile_image = path
    db.commit()
    remove_own_avatar_file(user.id, old)  # 이전에 올린 파일 정리
    return _to_out(user)


@router.delete("/auth/me/avatar", status_code=status.HTTP_204_NO_CONTENT)
def delete_avatar(
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    old = user.profile_image
    user.profile_image = None
    db.commit()
    remove_own_avatar_file(user.id, old)


@router.get("/profiles/{user_id}/image")
def profile_image(
    user_id: int,
    viewer: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    # 본인이거나, 같은 그룹에 속한 사람만 볼 수 있다
    if user_id != viewer.id:
        mine = aliased(GroupMember)
        theirs = aliased(GroupMember)
        shared = db.execute(
            select(mine.group_id)
            .join(theirs, theirs.group_id == mine.group_id)
            .where(mine.user_id == viewer.id, theirs.user_id == user_id)
            .limit(1)
        ).first()
        if shared is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "볼 수 없는 사진이에요.")

    target = db.get(User, user_id)
    image = target.profile_image if target is not None else None
    if not image:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "프로필 사진이 없어요.")

    if image.startswith("https://"):
        url = image  # 소셜 로그인 사진
    else:
        try:
            url = storage.signed_urls([image]).get(image)
        except storage.StorageError:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "사진을 불러오지 못했어요.")
        if not url:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "프로필 사진을 찾을 수 없어요.")

    return RedirectResponse(url, status_code=302, headers={"Cache-Control": "private, max-age=300"})
