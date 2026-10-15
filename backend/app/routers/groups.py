from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.deps.auth import get_current_user
from app.models import Group, GroupMember, User
from app.schemas import GroupCreateIn, GroupOut

router = APIRouter(prefix="/groups", tags=["groups"])


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