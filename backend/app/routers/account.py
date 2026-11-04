"""
내 계정 API

PATCH  /auth/me : 프로필(닉네임) 수정
DELETE /auth/me : 회원 탈퇴 (개인정보를 비우고 로그인 불가 상태로 바꾼다)

탈퇴를 '행 삭제'로 하지 않는 이유:
messages, votes 등 다른 팀원 테이블이 users 를 NO ACTION 외래키로 가리켜서
행을 지우면 오류가 난다. 그래서 개인정보만 파기하고 기록(채팅·투표 등)은 남긴다.

방장이 탈퇴하면 그 그룹의 방장은 남은 멤버 중 가장 먼저 들어온 사람에게 넘어간다.
"""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session as DbSession
from app.routers.avatar import remove_own_avatar_file

from app.config import SESSION_COOKIE_NAME
from app.db import get_db
from app.deps.auth import get_current_user
from app.models import GroupMember, OAuthAccount, Session as SessionRow, User
from app.routers.group_members import leave_and_handover
from app.schemas import UserOut
from app.security import verify_password

router = APIRouter(prefix="/auth", tags=["account"])

WITHDRAWN_NICKNAME = "탈퇴한 사용자"
CONFIRM_TEXT = "탈퇴"


class ProfileUpdate(BaseModel):
    nickname: str = Field(min_length=1, max_length=30)


class WithdrawIn(BaseModel):
    confirm: str                 # "탈퇴" 라고 직접 입력해야 한다
    password: str | None = None  # 비밀번호로 가입한 회원만 필요


@router.patch("/me", response_model=UserOut)
def update_me(
    body: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    nickname = body.nickname.strip()
    if not nickname:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "닉네임을 입력하세요.")
    user.nickname = nickname  # 대상은 항상 세션의 본인 (요청에서 id 를 받지 않는다)
    db.commit()
    return UserOut(
        id=user.id, nickname=user.nickname, email=user.email, profile_image=user.profile_image
    )


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def withdraw(
    body: WithdrawIn,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    if body.confirm != CONFIRM_TEXT:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f'확인 문구로 "{CONFIRM_TEXT}"를 입력하세요.')

    # 비밀번호로 가입한 회원은 비밀번호를 한 번 더 확인한다 (OAuth 가입자는 password 가 NULL)
    if user.password is not None:
        if not body.password or not verify_password(user.password, body.password):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "비밀번호가 올바르지 않습니다.")

    uid = user.id
    remove_own_avatar_file(uid, user.profile_image)  # 올린 프로필 사진 파일도 지운다

    # 속해 있던 모든 그룹에서 나간다 (방장이었다면 다음 멤버에게 방장을 넘긴다)
    group_ids = db.execute(
        select(GroupMember.group_id).where(GroupMember.user_id == uid)
    ).scalars().all()
    for gid in group_ids:
        leave_and_handover(db, gid, uid)

    # 위치·출발지처럼 개인 위치 정보는 지운다
    db.execute(text("DELETE FROM location_shares WHERE user_id = :u"), {"u": uid})
    db.execute(text("DELETE FROM meeting_place_departures WHERE user_id = :u"), {"u": uid})
    # 로그인 수단을 끊는다
    db.execute(delete(SessionRow).where(SessionRow.user_id == uid))
    db.execute(delete(OAuthAccount).where(OAuthAccount.user_id == uid))

    # 개인정보를 비우고 로그인 불가 상태로 바꾼다 (채팅·투표 기록의 연결은 유지)
    user.nickname = WITHDRAWN_NICKNAME
    user.name = None
    user.email = None
    user.password = None
    user.profile_image = None
    user.status = "dormant"
    db.commit()

    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return response