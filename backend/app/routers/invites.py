"""
초대 링크 API

[방장 전용]
POST   /groups/{group_id}/invite : 새 초대 링크 발급 (기존 링크는 자동 회수)
GET    /groups/{group_id}/invite : 현재 링크 상태 조회 (토큰 원문은 다시 볼 수 없음)
DELETE /groups/{group_id}/invite : 현재 링크 회수

[로그인한 누구나]
POST   /invites/{token}/join     : 초대 링크로 그룹 가입

규칙: 그룹당 유효한 링크 1개 / 기본 24시간, 5회 / 토큰은 해시만 저장
"""
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.config import FRONTEND_URL
from app.db import get_db
from app.deps.auth import get_current_user, require_group_owner
from app.models import Group, GroupMember, Invite, User
from app.security import hash_token

router = APIRouter(prefix="/groups", tags=["invites"])
join_router = APIRouter(prefix="/invites", tags=["invites"])

# 링크가 없는 경우 / 만료 / 회수 / 횟수 초과를 구분하지 않고 같은 메시지로 응답한다
INVALID_INVITE_MSG = "유효하지 않거나 만료된 초대 링크입니다."


class InviteCreateIn(BaseModel):
    expires_hours: int = Field(default=24, ge=1, le=168)  # 최대 7일
    max_uses: int = Field(default=5, ge=1, le=50)


class InviteIssued(BaseModel):
    token: str          # 원문은 지금 한 번만 보여준다 (DB 에는 해시만 저장)
    invite_url: str
    expires_at: datetime
    max_uses: int


class InviteStatus(BaseModel):
    active: bool
    expires_at: datetime | None = None
    max_uses: int | None = None
    used_count: int | None = None


class JoinOut(BaseModel):
    group_id: int
    name: str
    already_member: bool


# ---------------- 방장 전용 ----------------

@router.post("/{group_id}/invite", response_model=InviteIssued, status_code=status.HTTP_201_CREATED)
def issue_invite(
    group_id: int,
    body: InviteCreateIn | None = None,
    owner: GroupMember = Depends(require_group_owner),  # 방장이 아니면 403
    db: DbSession = Depends(get_db),
):
    body = body or InviteCreateIn()
    now = datetime.now(timezone.utc)

    # 같은 그룹에 동시에 발급해도 유효한 링크가 2개가 되지 않도록 그룹 행을 잠근다
    db.execute(select(Group).where(Group.id == group_id).with_for_update()).scalar_one()

    # 기존 링크를 모두 회수하고
    db.execute(
        update(Invite)
        .where(Invite.group_id == group_id, Invite.revoked_at.is_(None))
        .values(revoked_at=now)
    )

    # 새 링크를 만든다 (같은 트랜잭션)
    token = secrets.token_urlsafe(32)
    invite = Invite(
        group_id=group_id,
        token_hash=hash_token(token),
        created_by=owner.user_id,
        expires_at=now + timedelta(hours=body.expires_hours),
        max_uses=body.max_uses,
        used_count=0,
    )
    db.add(invite)
    db.commit()  # 커밋하면 잠금도 풀린다

    return InviteIssued(
        token=token,
        invite_url=f"{FRONTEND_URL}/invite/{token}",
        expires_at=invite.expires_at,
        max_uses=invite.max_uses,
    )


@router.get("/{group_id}/invite", response_model=InviteStatus)
def invite_status(
    group_id: int,
    owner: GroupMember = Depends(require_group_owner),
    db: DbSession = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    invite = db.scalar(
        select(Invite)
        .where(Invite.group_id == group_id, Invite.revoked_at.is_(None))
        .order_by(Invite.id.desc())
    )
    if invite is None:
        return InviteStatus(active=False)

    usable = invite.expires_at > now and invite.used_count < invite.max_uses
    return InviteStatus(
        active=usable,
        expires_at=invite.expires_at,
        max_uses=invite.max_uses,
        used_count=invite.used_count,
    )


@router.delete("/{group_id}/invite", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invite(
    group_id: int,
    owner: GroupMember = Depends(require_group_owner),
    db: DbSession = Depends(get_db),
):
    db.execute(
        update(Invite)
        .where(Invite.group_id == group_id, Invite.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------- 초대 링크로 가입 ----------------

@join_router.post("/{token}/join", response_model=JoinOut)
def join_group(
    token: str,
    user: User = Depends(get_current_user),  # 로그인 필요 (401)
    db: DbSession = Depends(get_db),
):
    invalid = HTTPException(status.HTTP_404_NOT_FOUND, INVALID_INVITE_MSG)
    now = datetime.now(timezone.utc)

    invite = db.scalar(select(Invite).where(Invite.token_hash == hash_token(token)))
    if invite is None:
        raise invalid

    group = db.get(Group, invite.group_id)
    if group is None:
        raise invalid

    # 이미 멤버면 사용 횟수를 쓰지 않고 성공으로 돌려준다
    if db.get(GroupMember, (invite.group_id, user.id)) is not None:
        return JoinOut(group_id=group.id, name=group.name, already_member=True)

    # 사용 횟수를 "조건부로 한 번에" 올린다.
    # 회수/만료/횟수 초과면 조건에 안 맞아서 0행이 바뀐다. 동시에 여러 명이 눌러도 max_uses 를 넘지 않는다.
    consumed = db.execute(
        update(Invite)
        .where(
            Invite.id == invite.id,
            Invite.revoked_at.is_(None),
            Invite.expires_at > now,
            Invite.used_count < Invite.max_uses,
        )
        .values(used_count=Invite.used_count + 1)
    )
    if consumed.rowcount != 1:
        db.rollback()
        raise invalid

    # 사용 횟수 증가와 멤버 추가는 같은 트랜잭션이다
    db.add(GroupMember(group_id=invite.group_id, user_id=user.id, role="member"))
    try:
        db.commit()
    except IntegrityError:
        # 같은 사람이 동시에 두 번 눌러서 이미 가입된 경우: 사용 횟수 증가도 같이 취소된다
        db.rollback()
        return JoinOut(group_id=group.id, name=group.name, already_member=True)

    return JoinOut(group_id=group.id, name=group.name, already_member=False)