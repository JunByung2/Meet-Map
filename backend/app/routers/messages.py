"""
GET  /groups/{group_id}/messages  : 그룹 채팅 목록 (after_id 를 주면 그 이후 새 메시지만)
POST /groups/{group_id}/messages  : 메시지 보내기

접근통제: 두 API 모두 require_group_member 를 거친다. (로그인 안 함 401 / 그룹 멤버 아님 403)
작성자(user_id)는 클라이언트가 보내는 값이 아니라 로그인 세션에서 가져온다. (사칭 방지)

이름: nickname 은 그룹 별명이 있으면 별명, 없으면 원래 닉네임이고,
account_nickname 은 항상 원래 닉네임이다. (어느 쪽으로 보여 줄지는 화면에서 고른다)
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import BigInteger, DateTime, Text, func, select
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.orm import Session as DbSession

from app.db import Base, get_db
from app.deps.auth import get_current_user, require_group_member
from app.models import GroupMember, User

router = APIRouter(prefix="/groups/{group_id}/messages", tags=["messages"])

PAGE_LIMIT = 100


# 이미 Supabase 에 만들어져 있는 messages 표와 같은 모양 (표를 새로 만들거나 바꾸지 않는다)
class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    group_id: Mapped[int | None] = mapped_column(BigInteger)
    user_id: Mapped[int | None] = mapped_column(BigInteger)
    text: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MessageOut(BaseModel):
    id: int
    group_id: int
    user_id: int | None
    nickname: str | None          # 그룹 별명이 있으면 별명, 없으면 원래 닉네임
    account_nickname: str | None = None  # 원래 닉네임
    text: str | None
    created_at: datetime
    mine: bool


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


def _to_out(
    msg: Message, account_nickname: str | None, alias: str | None, me_id: int
) -> MessageOut:
    return MessageOut(
        id=msg.id,
        group_id=msg.group_id,
        user_id=msg.user_id,
        nickname=alias or account_nickname,
        account_nickname=account_nickname,
        text=msg.text,
        created_at=msg.created_at,
        mine=msg.user_id == me_id,
    )


@router.get("", response_model=list[MessageOut])
def list_messages(
    group_id: int,
    after_id: int | None = Query(default=None, ge=0),
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    q = (
        select(Message, User.nickname, GroupMember.nickname)
        .join(User, User.id == Message.user_id, isouter=True)
        # 지금도 이 그룹의 멤버인 사람이면 그 그룹 별명을 가져온다 (나간 사람은 별명 없음)
        .join(
            GroupMember,
            (GroupMember.group_id == Message.group_id)
            & (GroupMember.user_id == Message.user_id),
            isouter=True,
        )
        .where(Message.group_id == group_id)  # 경로의 그룹(멤버 확인을 통과한 그룹)만
    )
    if after_id is None:
        # 처음 열 때: 최근 100개 (오래된 것부터 보이게 뒤집는다)
        rows = db.execute(q.order_by(Message.id.desc()).limit(PAGE_LIMIT)).all()
        rows.reverse()
    else:
        # 이후: after_id 보다 새로 생긴 것만
        rows = db.execute(q.where(Message.id > after_id).order_by(Message.id.asc()).limit(PAGE_LIMIT)).all()
    return [_to_out(m, nick, alias, user.id) for m, nick, alias in rows]


@router.post("", response_model=MessageOut, status_code=201)
def send_message(
    group_id: int,
    body: MessageIn,
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "메시지를 입력해 주세요.")
    msg = Message(group_id=group_id, user_id=user.id, text=text)
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return _to_out(msg, user.nickname, member.nickname, user.id)