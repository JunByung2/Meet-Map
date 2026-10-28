"""
그룹 상세 / 멤버 API (그룹 멤버만 접근 가능)

GET    /groups/{group_id}                  : 그룹 정보 + 멤버 목록
GET    /groups/{group_id}/members          : 멤버 목록만
PATCH  /groups/{group_id}/members/me       : 내 그룹 별명 설정 (비우면 해제)
DELETE /groups/{group_id}/members/me       : 그룹 나가기 (방장이면 다음 멤버에게 방장을 넘김)
DELETE /groups/{group_id}/members/{user_id}: 멤버 추방 (방장만)
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.deps.auth import require_group_member, require_group_owner
from app.models import Group, GroupMember, Invite, User

router = APIRouter(prefix="/groups", tags=["groups"])


class MemberItem(BaseModel):
    user_id: int
    nickname: str                      # 화면에 보여 줄 이름 (그룹 별명이 있으면 별명, 없으면 회원 닉네임)
    account_nickname: str | None = None  # 원래 닉네임 (회원 계정의 이름)
    group_nickname: str | None = None  # 이 그룹에서만 쓰는 별명 (없으면 None)
    profile_image: str | None
    role: str  # owner(방장) / member(멤버)
    is_me: bool = False


class GroupDetail(BaseModel):
    id: int
    name: str
    icon: str | None
    description: str | None
    started_on: date | None = None
    my_role: str
    members: list[MemberItem]


class AliasIn(BaseModel):
    nickname: str | None = Field(default=None, max_length=30)  # 비우면 별명 해제


def load_members(db: DbSession, group_id: int, viewer_id: int) -> list[MemberItem]:
    rows = db.execute(
        select(GroupMember, User)
        .join(User, User.id == GroupMember.user_id)
        .where(GroupMember.group_id == group_id)
        .order_by(GroupMember.joined_at, GroupMember.user_id)
    ).all()
    return [
        MemberItem(
            user_id=user.id,
            nickname=member.nickname or user.nickname,
            account_nickname=user.nickname,
            group_nickname=member.nickname,
            profile_image=user.profile_image,
            role=member.role,
            is_me=(user.id == viewer_id),
        )
        for member, user in rows
    ]


def leave_and_handover(db: DbSession, group_id: int, user_id: int) -> None:
    """멤버를 그룹에서 뺀다. (commit 은 호출한 쪽에서 한다)

    - 그 사람이 공유 중이던 위치 정보도 함께 지운다.
    - 방장이었다면 남은 멤버 중 가장 먼저 들어온 사람에게 방장을 넘긴다.
    - 남은 멤버가 없으면 초대 링크를 모두 지워서 아무도 더 들어올 수 없게 한다.
    """
    member = db.get(GroupMember, (group_id, user_id))
    was_owner = member is not None and member.role == "owner"
    if member is not None:
        db.delete(member)
        db.flush()

    db.execute(
        text("DELETE FROM location_shares WHERE group_id = :g AND user_id = :u"),
        {"g": group_id, "u": user_id},
    )

    if was_owner:
        successor = db.execute(
            select(GroupMember)
            .where(GroupMember.group_id == group_id)
            .order_by(GroupMember.joined_at, GroupMember.user_id)
            .limit(1)
        ).scalar_one_or_none()
        if successor is not None:
            successor.role = "owner"
        else:
            db.execute(delete(Invite).where(Invite.group_id == group_id))


@router.get("/{group_id}", response_model=GroupDetail)
def group_detail(
    group_id: int,
    me: GroupMember = Depends(require_group_member),  # 멤버가 아니면 여기서 403
    db: DbSession = Depends(get_db),
):
    group = db.get(Group, group_id)
    return GroupDetail(
        id=group.id,
        name=group.name,
        icon=group.icon,
        description=group.description,
        started_on=group.started_on,
        my_role=me.role,
        members=load_members(db, group_id, me.user_id),
    )


@router.get("/{group_id}/members", response_model=list[MemberItem])
def group_members(
    group_id: int,
    me: GroupMember = Depends(require_group_member),
    db: DbSession = Depends(get_db),
):
    return load_members(db, group_id, me.user_id)


# 주의: "/members/me" 는 "/members/{user_id}" 보다 먼저 와야 한다.
@router.patch("/{group_id}/members/me", response_model=MemberItem)
def set_my_alias(
    group_id: int,
    body: AliasIn,
    me: GroupMember = Depends(require_group_member),  # 대상은 항상 세션의 본인
    db: DbSession = Depends(get_db),
):
    alias = (body.nickname or "").strip() or None
    if alias is not None:
        # 같은 그룹 안에서 다른 멤버의 이름을 흉내 내지 못하게 막는다
        others = [m for m in load_members(db, group_id, me.user_id) if m.user_id != me.user_id]
        taken = {n.casefold() for o in others for n in (o.nickname, o.account_nickname) if n}
        if alias.casefold() in taken:
            raise HTTPException(status.HTTP_409_CONFLICT, "이 그룹에서 이미 쓰고 있는 이름이에요.")
    me.nickname = alias
    db.commit()
    user = db.get(User, me.user_id)
    return MemberItem(
        user_id=user.id,
        nickname=alias or user.nickname,
        account_nickname=user.nickname,
        group_nickname=alias,
        profile_image=user.profile_image,
        role=me.role,
        is_me=True,
    )


@router.delete("/{group_id}/members/me", status_code=status.HTTP_204_NO_CONTENT)
def leave_group(
    group_id: int,
    me: GroupMember = Depends(require_group_member),
    db: DbSession = Depends(get_db),
):
    leave_and_handover(db, group_id, me.user_id)
    db.commit()


@router.delete("/{group_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def kick_member(
    group_id: int,
    user_id: int,
    me: GroupMember = Depends(require_group_owner),  # 방장만
    db: DbSession = Depends(get_db),
):
    if user_id == me.user_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "자기 자신은 추방할 수 없습니다.")
    target = db.get(GroupMember, (group_id, user_id))  # 이 그룹의 멤버만 찾는다
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "그 그룹의 멤버가 아닙니다.")
    if target.role == "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "방장은 추방할 수 없습니다.")
    leave_and_handover(db, group_id, user_id)
    db.commit()