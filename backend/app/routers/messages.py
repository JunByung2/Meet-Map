"""
GET  /groups/{group_id}/messages  : 그룹 채팅 목록 (after_id 를 주면 그 이후 새 메시지만)
POST /groups/{group_id}/messages  : 메시지 보내기

접근통제: 두 API 모두 require_group_member 를 거친다. (로그인 안 함 401 / 그룹 멤버 아님 403)
작성자(user_id)는 클라이언트가 보내는 값이 아니라 로그인 세션에서 가져온다. (사칭 방지)
"""
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import BigInteger, DateTime, Text, func, select
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.orm import Session as DbSession

from app.db import Base, get_db
from app.deps.auth import get_current_user, require_group_member
from app.models import ChatAttachment, GroupMember, User

router = APIRouter(prefix="/groups/{group_id}/messages", tags=["messages"])

PAGE_LIMIT = 100
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
    nickname: str | None
    text: str | None
    created_at: datetime
    mine: bool


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


def _to_out(msg: Message, nickname: str | None, me_id: int) -> MessageOut:
    return MessageOut(
        id=msg.id,
        group_id=msg.group_id,
        user_id=msg.user_id,
        nickname=nickname,
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
        select(Message, User.nickname)
        .join(User, User.id == Message.user_id, isouter=True)
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
    return [_to_out(m, nick, user.id) for m, nick in rows]


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
        from fastapi import HTTPException

        raise HTTPException(422, "메시지를 입력해 주세요.")
    msg = Message(group_id=group_id, user_id=user.id, text=text)
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return _to_out(msg, user.nickname, user.id)


@router.delete("/{message_id}", status_code=204)
def delete_message(
    group_id: int,
    message_id: int,
    member: GroupMember = Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    """보낸 메시지 삭제: 보낸 사람 본인 또는 방장. (투표로 만들어진 약속·지난 기록은 지워지지 않는다)"""
    from fastapi import HTTPException

    msg = db.get(Message, message_id)
    if msg is None or msg.group_id != group_id:
        raise HTTPException(404, "메시지를 찾을 수 없습니다.")
    if msg.user_id != user.id and member.role != "owner":
        raise HTTPException(403, "내가 보낸 메시지만 삭제할 수 있어요.")

    # 첨부(사진/파일)가 붙은 메시지면 첨부 기록도 정리한다. 파일은 지우고,
    # 사진은 사진 모음에 그대로 남긴다(사진 페이지에서 따로 삭제).
    last = (msg.text or "").split("\n")[-1]
    if last.startswith("attach:") and last[7:].isdigit():
        att = db.get(ChatAttachment, int(last[7:]))
        if att is not None and att.group_id == group_id:
            if att.kind == "file" and not att.storage_path.startswith("db:"):
                try:
                    from app import storage

                    storage.remove([att.storage_path])
                except Exception:  # noqa: BLE001  (저장소 오류가 나도 메시지 삭제는 진행)
                    pass
            if att.kind == "file":
                db.delete(att)
            # 사진 첨부 기록은 남겨 둔다: 사진 모음의 '채팅 사진' 분류와 지난 기록 연결이 유지된다.

    db.delete(msg)
    db.commit()
    return None
