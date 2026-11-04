"""
그룹 상세 / 멤버 목록 API (그룹 멤버만 접근 가능)

GET /groups/{group_id}          : 그룹 정보 + 멤버 목록
GET /groups/{group_id}/members  : 멤버 목록만
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.deps.auth import require_group_member
from app.models import Group, GroupMember, User

router = APIRouter(prefix="/groups", tags=["groups"])


class MemberItem(BaseModel):
    user_id: int
    nickname: str
    profile_image: str | None
    role: str  # owner(방장) / member(멤버)


class GroupDetail(BaseModel):
    id: int
    name: str
    icon: str | None
    description: str | None
    my_role: str
    members: list[MemberItem]


def load_members(db: DbSession, group_id: int) -> list[MemberItem]:
    rows = db.execute(
        select(GroupMember, User)
        .join(User, User.id == GroupMember.user_id)
        .where(GroupMember.group_id == group_id)
        .order_by(GroupMember.joined_at, GroupMember.user_id)
    ).all()
    return [
        MemberItem(
            user_id=user.id,
            nickname=user.nickname,
            profile_image=user.profile_image,
            role=member.role,
        )
        for member, user in rows
    ]


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
        my_role=me.role,
        members=load_members(db, group_id),
    )


@router.get("/{group_id}/members", response_model=list[MemberItem])
def group_members(
    group_id: int,
    me: GroupMember = Depends(require_group_member),
    db: DbSession = Depends(get_db),
):
    return load_members(db, group_id)