from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession
from datetime import date

from app.db import get_db
from app.deps.auth import get_current_user, require_group_owner
from app.models import Group, GroupMember, User
from app.schemas import GroupCreateIn, GroupOut

router = APIRouter(prefix="/groups", tags=["groups"])


class GroupUpdateIn(BaseModel):
    # 보낸 항목만 바꾼다. 글자 수 제한은 그룹 생성과 같다.
    name: str | None = Field(default=None, min_length=1, max_length=50)
    icon: str | None = Field(default=None, max_length=20)
    description: str | None = Field(default=None, max_length=500)
    started_on: date | None = None  # 첫 만남일. null 을 보내면 지운다


class OwnerTransferIn(BaseModel):
    user_id: int


@router.post("", status_code=status.HTTP_201_CREATED, response_model=GroupOut)
def create_group(body: GroupCreateIn, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)):
    """그룹 생성. 만든 사람은 자동으로 방장(owner)이 된다. 그룹과 방장 등록은 한 트랜잭션."""
    group = Group(name=body.name.strip(), icon=body.icon, description=body.description, created_by=user.id)
    db.add(group)
    db.flush()  # group.id 확정
    db.add(GroupMember(group_id=group.id, user_id=user.id, role="owner"))
    db.commit()
    return GroupOut(id=group.id, name=group.name, icon=group.icon, description=group.description, role="owner")


@router.get("", response_model=list[GroupOut])
def list_my_groups(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)):
    """내가 속한 그룹만 돌려준다."""
    rows = db.execute(
        select(Group, GroupMember.role)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.user_id == user.id)
        .order_by(Group.id)
    ).all()
    return [
        GroupOut(id=g.id, name=g.name, icon=g.icon, description=g.description, role=role)
        for g, role in rows
    ]


@router.patch("/{group_id}", response_model=GroupOut)
def update_group(
    group_id: int,
    body: GroupUpdateIn,
    me: GroupMember = Depends(require_group_owner),  # 방장만
    db: DbSession = Depends(get_db),
):
    """그룹 이름·아이콘·설명 수정 (방장 전용)."""
    group = db.get(Group, group_id)
    fields = body.model_dump(exclude_unset=True)

    if "name" in fields:
        name = (fields["name"] or "").strip()
        if not name:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "그룹 이름을 입력하세요.")
        group.name = name
    if "icon" in fields:
        group.icon = (fields["icon"] or "").strip() or None
    if "description" in fields:
        group.description = (fields["description"] or "").strip() or None
    if "started_on" in fields:
        group.started_on = fields["started_on"]

    db.commit()
    return GroupOut(
        id=group.id, name=group.name, icon=group.icon, description=group.description, role=me.role
    )


@router.post("/{group_id}/owner", status_code=status.HTTP_204_NO_CONTENT)
def transfer_owner(
    group_id: int,
    body: OwnerTransferIn,
    me: GroupMember = Depends(require_group_owner),  # 방장만
    db: DbSession = Depends(get_db),
):
    """방장을 같은 그룹의 다른 멤버에게 넘긴다. 나는 일반 멤버가 된다."""
    if body.user_id == me.user_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "이미 방장입니다.")
    target = db.get(GroupMember, (group_id, body.user_id))  # 이 그룹의 멤버만 찾는다
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "그 그룹의 멤버가 아닙니다.")
    target.role = "owner"
    me.role = "member"
    db.commit()