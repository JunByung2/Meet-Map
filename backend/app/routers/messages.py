"""
GET  /groups/{group_id}/messages  : 그룹 채팅 목록 (after_id 를 주면 그 이후 새 메시지만)
POST /groups/{group_id}/messages  : 메시지 보내기

접근통제: 두 API 모두 require_group_member 를 거친다. (로그인 안 함 401 / 그룹 멤버 아님 403)
작성자(user_id)는 클라이언트가 보내는 값이 아니라 로그인 세션에서 가져온다. (사칭 방지)

이름: nickname 은 그룹 별명이 있으면 별명, 없으면 원래 닉네임이고,
account_nickname 은 항상 원래 닉네임이다. (어느 쪽으로 보여 줄지는 화면에서 고른다)
"""
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import BigInteger, DateTime, Text, func, select
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.orm import Session as DbSession

from app.db import Base, get_db
from app.deps.auth import get_current_user, require_group_member
from app.linked_delete import delete_messages, remove_message_photos
from app.models import GroupMember, User

router = APIRouter(prefix="/groups/{group_id}/messages", tags=["messages"])

PAGE_LIMIT = 100
IDS_LIMIT = 3000  # /ids 가 한 번에 돌려주는 최대 개수
FROM_DATE_LIMIT = 500  # 지난 기록에서 특정 날짜로 이동할 때 한 번에 보내는 최대 개수
KST = timezone(timedelta(hours=9))


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


class RemovePhotosIn(BaseModel):
    attachment_ids: list[int] = Field(min_length=1, max_length=30)


class BulkDeleteIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=100)


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
    before_id: int | None = Query(default=None, ge=1),  # 이 번호보다 앞(이전) 메시지 100개 (위로 스크롤해서 이전 대화 더 보기)
    from_date: date | None = Query(default=None),  # 이 날짜(한국 시간 0시)부터의 대화 (지난 기록 → 채팅 이동용)
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
    if after_id is None and isinstance(before_id, int):
        rows = db.execute(q.where(Message.id < before_id).order_by(Message.id.desc()).limit(PAGE_LIMIT)).all()
        rows.reverse()
    elif after_id is None and isinstance(from_date, date):
        start = datetime(from_date.year, from_date.month, from_date.day, tzinfo=KST)
        rows = db.execute(
            q.where(Message.created_at >= start).order_by(Message.id.asc()).limit(FROM_DATE_LIMIT)
        ).all()
    elif after_id is None:
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


@router.get("/ids", response_model=list[int])
def list_message_ids(
    group_id: int,
    min_id: int = Query(0, ge=0),
    member: GroupMember = Depends(require_group_member),
    db: DbSession = Depends(get_db),
):
    """지금 남아 있는 메시지 번호들 (min_id 이상). 다른 곳에서 지운 메시지를 열려 있는 채팅에서 치우는 데 쓴다."""
    rows = db.scalars(
        select(Message.id).where(Message.group_id == group_id, Message.id >= min_id).order_by(Message.id).limit(IDS_LIMIT)
    ).all()
    return list(rows)


@router.post("/bulk-delete")
def bulk_delete_messages(
    group_id: int,
    body: BulkDeleteIn,
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    """여러 메시지를 한 번에 삭제: 내가 보낸 메시지, 방장은 모두.
    권한이 없는 메시지는 건너뛰고 번호를 돌려준다. 사진 메시지는 사진 페이지의 사진도 함께 지워진다."""
    deleted, skipped = delete_messages(db, group_id, body.ids, user, member, strict=False)
    return {"deleted": deleted, "skipped": skipped}


@router.post("/{message_id}/remove-photos")
def remove_photos(
    group_id: int,
    message_id: int,
    body: RemovePhotosIn,
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    """묶어서 보낸 사진 말풍선에서 고른 사진만 지운다. 사진 페이지·저장소 파일도 함께 지워지고,
    남는 사진이 없으면 말풍선도 지워진다."""
    gone, remaining, text = remove_message_photos(db, group_id, message_id, body.attachment_ids, user, member)
    return {"message_deleted": gone, "remaining": remaining, "text": text}


@router.delete("/{message_id}", status_code=204)
def delete_message(
    group_id: int,
    message_id: int,
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    """보낸 메시지 삭제: 보낸 사람 본인 또는 방장. 사진 메시지는 사진 페이지의 사진도 함께 지워진다.
    (투표로 만들어진 약속·지난 기록은 지워지지 않는다)"""
    delete_messages(db, group_id, [message_id], user, member, strict=True)
    return None
