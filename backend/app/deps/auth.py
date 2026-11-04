"""
인증 / 접근통제 의존성 (다른 팀원이 가져다 쓰는 파일)

사용법:
    from app.deps.auth import get_current_user, require_group_member, require_group_owner

    # 로그인만 필요한 API
    @router.get("/me")
    def me(user = Depends(get_current_user)): ...

    # 그룹 멤버만 접근 가능한 API (경로에 반드시 {group_id} 가 있어야 함)
    @router.get("/groups/{group_id}/messages")
    def list_messages(group_id: int, member = Depends(require_group_member)): ...

    # 방장만 가능한 API
    @router.patch("/groups/{group_id}")
    def update_group(group_id: int, member = Depends(require_group_owner)): ...

사용자 확인 순서:
    1) 세션 쿠키(session_id) -> sessions 테이블 -> 회원
    2) (ALLOW_DEV_AUTH=true 일 때만) 개발용 X-User-Id 헤더
    3) 둘 다 아니면 401
"""
from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session as DbSession

from app.config import ALLOW_DEV_AUTH, SESSION_COOKIE_NAME
from app.db import get_db
from app.models import GroupMember, Session, User
from app.security import hash_token

UNAUTHORIZED_MSG = "로그인이 필요합니다."


def get_current_user(
    request: Request,
    x_user_id: int | None = Header(default=None),
    db: DbSession = Depends(get_db),
) -> User:
    """현재 로그인한 회원을 돌려준다. 확인 못 하면 401."""
    # 1) 세션 쿠키 확인 (쿠키에는 원본 토큰, DB에는 그 해시가 저장돼 있다)
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token:
        session = db.get(Session, hash_token(token))
        if session is not None:
            if session.expires_at <= datetime.now(timezone.utc):
                # 만료된 세션은 지운다
                db.delete(session)
                db.commit()
            else:
                user = db.get(User, session.user_id)
                if user is not None and user.status == "active":
                    return user

    # 2) 개발용 임시 인증 (개발 환경에서만)
    if ALLOW_DEV_AUTH and x_user_id is not None:
        user = db.get(User, x_user_id)
        if user is not None and user.status == "active":
            return user

    raise HTTPException(status.HTTP_401_UNAUTHORIZED, UNAUTHORIZED_MSG)


def require_group_member(
    group_id: int,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> GroupMember:
    """요청자가 이 그룹의 멤버일 때만 통과. 아니면 403.

    그룹이 없는 경우와 멤버가 아닌 경우를 같은 403으로 응답해서
    '그 그룹이 존재하는지'가 밖으로 드러나지 않게 한다.
    """
    member = db.get(GroupMember, (group_id, user.id))
    if member is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "접근 권한이 없습니다.")
    return member


def require_group_owner(
    member: GroupMember = Depends(require_group_member),
) -> GroupMember:
    """그룹 멤버 중 방장(owner)만 통과. 멤버면 403."""
    if member.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "방장만 할 수 있습니다.")
    return member