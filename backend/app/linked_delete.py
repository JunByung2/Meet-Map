"""채팅방과 사진 페이지의 삭제를 하나로 묶는다.

채팅으로 보낸 사진은 세 군데에 같은 파일(storage_path)로 남아 있다.
  1) messages          : 채팅 말풍선 (마지막 줄 `attach:번호`, 묶어서 보낸 사진은 `attach:1,2,3`)
  2) chat_attachments  : 채팅 첨부 기록
  3) group_photos      : 사진 페이지의 사진 (제목 "채팅 사진")
그리고 파일 본체는 사진 저장소(Supabase)에 한 번만 있다.

어느 쪽에서 지우든 위 네 가지를 함께 지운다. 그래서 채팅에서 사진을 지우면 사진 페이지에서도,
사진 페이지에서 지우면 채팅에서도 사라진다.

권한은 호출한 쪽이 '지우려는 것'에 대해 먼저 검사하고, 여기서는 '함께 지워지는 것'을 한 번 더 검사한다.
(규칙은 기존과 같다: 올린 사람 본인 또는 방장)
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session as DbSession

from app import storage
from app.models import ChatAttachment, GroupMember, Photo, User


def attach_ids_of(text: str | None) -> list[int]:
    """메시지 마지막 줄이 `attach:번호` 또는 `attach:1,2,3`(묶음) 이면 그 번호들, 아니면 빈 목록"""
    last = (text or "").split("\n")[-1]
    if not last.startswith("attach:"):
        return []
    parts = last[7:].split(",")
    if not parts or not all(p.isdigit() for p in parts):
        return []
    return [int(p) for p in parts]


def attach_id_of(text: str | None) -> int | None:
    """(예전 함수) 첨부가 하나인 메시지의 번호. 묶음이면 첫 번째"""
    ids = attach_ids_of(text)
    return ids[0] if ids else None


def _bundle_text(ids: list[int]) -> str:
    """남은 사진 번호로 말풍선 글을 다시 만든다 (한 장이면 '사진', 여러 장이면 '사진 N장')"""
    label = "📷 사진" if len(ids) == 1 else f"📷 사진 {len(ids)}장"
    return f"{label}\nattach:{','.join(str(i) for i in ids)}"


def _allowed(owner_id: int | None, user: User, member: GroupMember) -> bool:
    return owner_id == user.id or member.role == "owner"


def _purge(
    db: DbSession,
    group_id: int,
    user: User,
    member: GroupMember,
    *,
    paths: list[str],
    messages: list,
    attachments: list[ChatAttachment],
) -> None:
    """사진 파일(paths)과 거기에 연결된 사진·첨부·메시지를 한꺼번에 지운다.

    저장소에서 먼저 지우고(실패하면 DB 는 그대로 둔다), 성공하면 DB 를 지우고 저장한다.
    """
    from app.routers.messages import Message  # messages 라우터가 이 파일을 쓰므로 여기서 불러온다

    paths = list(dict.fromkeys(paths))

    photos = (
        list(db.scalars(select(Photo).where(Photo.group_id == group_id, Photo.storage_path.in_(paths))))
        if paths
        else []
    )
    image_atts = (
        list(
            db.scalars(
                select(ChatAttachment).where(
                    ChatAttachment.group_id == group_id,
                    ChatAttachment.kind == "image",
                    ChatAttachment.storage_path.in_(paths),
                )
            )
        )
        if paths
        else []
    )

    atts: dict[int, ChatAttachment] = {a.id: a for a in attachments}
    atts.update({a.id: a for a in image_atts})

    # 지워지는 첨부를 가리키는 채팅 말풍선
    #  - 그 말풍선의 사진이 전부 지워지면 말풍선도 지운다
    #  - 묶음 말풍선에서 일부 사진만 지워지면, 남은 사진만 보이도록 말풍선 글을 고친다
    msgs: dict[int, object] = {m.id: m for m in messages}
    edits: dict[int, tuple[object, list[int]]] = {}
    gone_ids = set(a.id for a in image_atts)
    if gone_ids:
        rows = db.scalars(
            select(Message).where(
                Message.group_id == group_id,
                or_(*[Message.text.like(f"%attach:%{i}%") for i in gone_ids]),
            )
        )
        for m in rows:
            ids = attach_ids_of(m.text)
            if not any(i in gone_ids for i in ids):
                continue
            remaining = [i for i in ids if i not in gone_ids]
            if remaining and m.id not in msgs:
                edits[m.id] = (m, remaining)
            else:
                msgs[m.id] = m

    # 함께 지워지는 것도 내가 지울 수 있는 것이어야 한다
    if (
        any(not _allowed(p.user_id, user, member) for p in photos)
        or any(not _allowed(a.user_id, user, member) for a in atts.values())
        or any(not _allowed(m.user_id, user, member) for m in msgs.values())
        or any(not _allowed(m.user_id, user, member) for m, _ in edits.values())
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "올린 사람이나 방장만 삭제할 수 있어요.")

    remove_paths = list(paths)
    # 예전에 저장소에 올렸던 문서 파일 (지금은 'db:' 로 DB 에 저장한다)
    remove_paths += [a.storage_path for a in atts.values() if a.kind == "file" and not a.storage_path.startswith("db:")]
    remove_paths = list(dict.fromkeys(remove_paths))
    if remove_paths:
        if not storage.is_configured():
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "사진 저장소(Supabase)가 아직 설정되지 않았어요.")
        try:
            storage.remove(remove_paths)
        except storage.StorageError as e:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"사진 저장소 오류: {e}") from e

    for m, remaining in edits.values():
        m.text = _bundle_text(remaining)
    for obj in (*photos, *atts.values(), *msgs.values()):
        db.delete(obj)
    db.commit()


def delete_messages(
    db: DbSession,
    group_id: int,
    ids: list[int],
    user: User,
    member: GroupMember,
    *,
    strict: bool,
) -> tuple[list[int], list[int]]:
    """채팅 메시지를 지운다. 사진 메시지는 사진 페이지의 사진과 파일까지 함께 지운다.

    strict=True  : 없으면 404, 권한이 없으면 403 (메시지 하나를 지울 때)
    strict=False : 이미 없으면 지운 것으로 치고, 권한이 없는 것은 건너뛴다 (여러 개를 지울 때)
    반환: (지운 번호들, 건너뛴 번호들)
    """
    from app.routers.messages import Message

    ids = list(dict.fromkeys(ids))
    found = {m.id: m for m in db.scalars(select(Message).where(Message.group_id == group_id, Message.id.in_(ids)))}

    deleted: list[int] = []
    skipped: list[int] = []
    targets = []
    for i in ids:
        m = found.get(i)
        if m is None:
            if strict:
                raise HTTPException(404, "메시지를 찾을 수 없습니다.")
            deleted.append(i)  # 이미 지워졌다
            continue
        if not _allowed(m.user_id, user, member):
            if strict:
                raise HTTPException(403, "내가 보낸 메시지만 삭제할 수 있어요.")
            skipped.append(i)
            continue
        targets.append(m)

    att_ids = [i for m in targets for i in attach_ids_of(m.text)]
    atts = (
        list(db.scalars(select(ChatAttachment).where(ChatAttachment.group_id == group_id, ChatAttachment.id.in_(att_ids))))
        if att_ids
        else []
    )
    image_paths = [a.storage_path for a in atts if a.kind == "image"]
    file_atts = [a for a in atts if a.kind == "file"]

    if targets:
        _purge(db, group_id, user, member, paths=image_paths, messages=targets, attachments=file_atts)
        deleted.extend(m.id for m in targets)
    return deleted, skipped


def delete_photo_batches(
    db: DbSession,
    group_id: int,
    batch_ids: list[str],
    user: User,
    member: GroupMember,
    *,
    strict: bool,
) -> tuple[list[str], list[str]]:
    """사진 묶음을 지운다. 채팅으로 보낸 사진이면 채팅 말풍선과 첨부 기록까지 함께 지운다.

    strict=True  : 없으면 404, 권한이 없으면 403 (묶음 하나를 지울 때)
    strict=False : 이미 없으면 지운 것으로 치고, 권한이 없는 것은 건너뛴다 (여러 개를 지울 때)
    반환: (지운 묶음 번호들, 건너뛴 묶음 번호들)
    """
    batch_ids = list(dict.fromkeys(batch_ids))
    rows = list(db.scalars(select(Photo).where(Photo.group_id == group_id, Photo.batch_id.in_(batch_ids))))
    by_batch: dict[str, list[Photo]] = {}
    for p in rows:
        by_batch.setdefault(p.batch_id, []).append(p)

    deleted: list[str] = []
    skipped: list[str] = []
    paths: list[str] = []
    for b in batch_ids:
        photos = by_batch.get(b)
        if not photos:
            if strict:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "사진을 찾을 수 없습니다.")
            deleted.append(b)
            continue
        if not all(_allowed(p.user_id, user, member) for p in photos):
            if strict:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "올린 사람이나 방장만 삭제할 수 있어요.")
            skipped.append(b)
            continue
        paths.extend(p.storage_path for p in photos)
        deleted.append(b)

    if paths:
        _purge(db, group_id, user, member, paths=paths, messages=[], attachments=[])
    return deleted, skipped


def remove_message_photos(
    db: DbSession,
    group_id: int,
    message_id: int,
    attachment_ids: list[int],
    user: User,
    member: GroupMember,
) -> tuple[bool, list[int], str | None]:
    """묶어서 보낸 사진 말풍선에서 고른 사진만 지운다 (사진 페이지·저장소 파일도 함께).
    남는 사진이 없으면 말풍선도 지운다.
    반환: (말풍선까지 지워졌는지, 남은 첨부 번호들, 말풍선의 새 글 — 지워졌으면 None)
    권한: 말풍선을 보낸 사람 또는 방장. 말풍선에 없는 번호가 섞여 있으면 422.
    """
    from app.routers.messages import Message

    m = db.get(Message, message_id)
    if m is None or m.group_id != group_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "메시지를 찾을 수 없습니다.")
    if not _allowed(m.user_id, user, member):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "내가 보낸 메시지만 고칠 수 있어요.")
    ids = attach_ids_of(m.text)
    wanted = list(dict.fromkeys(attachment_ids))
    if not ids or not wanted or any(i not in ids for i in wanted):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "이 말풍선에 없는 사진이 섞여 있어요.")

    atts = list(
        db.scalars(select(ChatAttachment).where(ChatAttachment.group_id == group_id, ChatAttachment.id.in_(wanted)))
    )
    paths = [a.storage_path for a in atts if a.kind == "image"]
    remaining = [i for i in ids if i not in wanted]
    if paths:
        # _purge 가 사진·첨부를 지우고, 이 말풍선은 남은 사진만 보이게 고치거나(일부) 지운다(전부)
        _purge(db, group_id, user, member, paths=paths, messages=[], attachments=[])
    else:
        # 이미 첨부 기록이 없는 번호(예전에 지워짐)면 말풍선 글만 정리한다
        if remaining:
            m.text = _bundle_text(remaining)
        else:
            db.delete(m)
        db.commit()
    if db.get(Message, message_id) is None:
        return True, [], None
    db.refresh(m)
    return False, attach_ids_of(m.text), m.text
