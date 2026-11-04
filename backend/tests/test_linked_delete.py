"""채팅방 <-> 사진 페이지 삭제 연동과 여러 개 선택 삭제 검증.
임시 SQLite + 가짜 저장소만 쓰고 공유 DB/Supabase 에는 접속하지 않는다.
backend 폴더에서:  python tests/test_linked_delete.py
"""
import io
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["ALLOW_DEV_AUTH"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException, UploadFile
from sqlalchemy import BigInteger, create_engine, select
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session

from app import storage
from app.db import Base
from app.deps.auth import require_group_member
from app.models import ChatAttachment, Group, GroupMember, Photo, User
from app.routers import chat_files
from app.routers import messages as chat
from app.routers import photos as photo_api


@compiles(BigInteger, "sqlite")
def sqlite_big_integer(element, compiler, **kw):
    return "INTEGER"


checks = 0


def check(cond, label):
    global checks
    assert cond, label
    checks += 1
    print(f"PASS {label}")


PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def png(name="a.png"):
    return UploadFile(file=io.BytesIO(PNG), filename=name)


def raises(code, fn):
    try:
        fn()
    except HTTPException as e:
        return e.status_code == code
    return False


def main():
    with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as tmp:
        engine = create_engine(f"sqlite:///{Path(tmp) / 't.sqlite'}", connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            db.add_all([User(id=i, nickname=f"m{i}", status="active") for i in (1, 2, 3)])
            db.flush()
            db.add_all([Group(id=11, name="g11", created_by=1), Group(id=12, name="g12", created_by=3)])
            db.flush()
            db.add_all(
                GroupMember(group_id=g, user_id=u, role=r)
                for g, u, r in ((11, 1, "owner"), (11, 2, "member"), (11, 3, "member"), (12, 3, "owner"))
            )
            db.commit()

        stored: list[str] = []
        removed: list[str] = []
        state = {"fail_remove": False}

        def fake_remove(paths):
            if state["fail_remove"]:
                raise storage.StorageError("boom")
            removed.extend(paths)

        fake = {
            "is_configured": lambda: True,
            "upload": lambda path, data, ct: stored.append(path),
            "signed_urls": lambda paths: {p: f"https://signed/{p}" for p in paths},
            "remove": fake_remove,
        }

        def ctx(user, group):
            db = Session(engine, expire_on_commit=False)
            u = db.get(User, user)
            m = require_group_member(group, u, db)
            return db, u, m

        def chat_photo(db, u, m, name="c.png"):
            """채팅으로 사진을 보낸 것과 같은 상태를 만든다: (말풍선, 첨부, 저장 경로)"""
            att = chat_files.upload_chat_file(11, png(name), "image", m, u, db)
            msg = chat.send_message(11, chat.MessageIn(text=f"📷 사진\nattach:{att.id}"), m, u, db)
            path = db.get(ChatAttachment, att.id).storage_path
            return msg, att, path

        def photos_with(db, path):
            return list(db.scalars(select(Photo).where(Photo.storage_path == path)))

        def alive(db, msg_id):
            return db.get(chat.Message, msg_id) is not None

        with patch.multiple(storage, **fake):
            db1, u1, m1 = ctx(1, 11)  # 방장
            db2, u2, m2 = ctx(2, 11)  # 멤버
            db3, u3, m3 = ctx(3, 11)  # 멤버

            # 0) 사진을 나눠 올리기(진행률/재시도용): 같은 batch_id 로 이어 붙이고, 이미 올라간 자리는 건너뛴다
            import uuid as _uuid
            bid = str(_uuid.uuid4())

            def chunk(db, u, m, names, start, batch=bid):
                return photo_api.upload_photos(11, [png(n) for n in names], [], "제목", "", None, None, None, None, None, batch, start, m, u, db)

            n_before = len(stored)
            a = chunk(db2, u2, m2, ["c1.png", "c2.png", "c3.png"], 0)
            b = chunk(db2, u2, m2, ["c4.png", "c5.png"], 3)
            check(len(a) == 3 and len(b) == 2, "나눠 올린 사진이 각각 돌아온다")
            check({p.batch_id for p in a + b} == {bid}, "나눠 올려도 같은 묶음이 된다")
            check([p.sort_order for p in a + b] == [0, 1, 2, 3, 4], "나눠 올려도 순서 번호가 이어진다")
            again = chunk(db2, u2, m2, ["c4.png", "c5.png"], 3)  # 재시도(이미 올라간 자리)
            check(len(stored) - n_before == 5, "재시도해도 저장소에 중복으로 올라가지 않는다")
            check([p.id for p in again] == [p.id for p in b], "재시도하면 이미 올라간 사진을 그대로 돌려준다")
            check(len(list(db2.scalars(select(Photo).where(Photo.batch_id == bid)))) == 5, "재시도해도 DB 행이 늘지 않는다")
            check(raises(403, lambda: chunk(db3, u3, m3, ["x.png"], 5)), "남이 만든 묶음에는 사진을 더할 수 없다")
            check(raises(422, lambda: chunk(db2, u2, m2, ["y.png"], photo_api.PHOTO_MAX_FILES)), "한 묶음은 최대 장수를 넘길 수 없다")
            check(raises(422, lambda: chunk(db2, u2, m2, ["y.png"], 5, batch="not-a-uuid")), "묶음 번호 형식이 틀리면 거절한다")
            before = len(list(db2.scalars(select(Photo))))
            check(raises(422, lambda: chunk(db2, u2, m2, ["ok.png", "bad.txt"], 5)), "섞여 있는 나쁜 파일은 이번 요청 전체를 거절한다")
            check(len(list(db2.scalars(select(Photo)))) == before, "거절된 요청은 아무것도 남기지 않는다")
            photo_api.delete_batch(11, bid, m2, u2, db2)

            # 00) 묶음 사진 정보를 한 번에 받는다 (이 그룹 것만, 없는 번호는 빠진다)
            ca = [chat_files.upload_chat_file(11, png(f"i{n}.png"), "image", m2, u2, db2, light=True) for n in range(3)]
            check(ca[0].signed_url is None, "light 로 올리면 응답에 임시 주소를 만들지 않는다(빠르게)")
            info = chat_files.chat_files_info(11, f"{ca[0].id},{ca[2].id},999999", m2, db2)
            check([a.id for a in info] == [ca[0].id, ca[2].id], "여러 첨부 정보는 있는 것만 순서대로 돌아온다")
            check(all(a.signed_url for a in info), "여러 첨부 정보에 임시 주소가 들어 있다")
            check(raises(422, lambda: chat_files.chat_files_info(11, "a,b", m2, db2)), "ids 형식이 틀리면 거절한다")
            check(chat_files.chat_files_info(12, str(ca[0].id), require_group_member(12, u3, db3), db3) == [], "다른 그룹의 첨부는 보이지 않는다")

            # 000) 묶음 말풍선에서 고른 사진만 지우기
            def bundle3(db, u, m):
                atts = [chat_files.upload_chat_file(11, png(f"p{n}.png"), "image", m, u, db) for n in range(3)]
                msg = chat.send_message(11, chat.MessageIn(text="📷 사진 3장\nattach:" + ",".join(str(a.id) for a in atts)), m, u, db)
                return msg, atts

            msg, atts = bundle3(db2, u2, m2)
            p1 = db2.get(ChatAttachment, atts[1].id).storage_path
            res = chat.remove_photos(11, msg.id, chat.RemovePhotosIn(attachment_ids=[atts[1].id]), m2, u2, db2)
            check(res["message_deleted"] is False and res["remaining"] == [atts[0].id, atts[2].id], "묶음에서 고른 한 장만 빠지고 나머지는 남는다")
            check(db2.get(chat.Message, msg.id).text.startswith("📷 사진 2장"), "남은 장수에 맞게 말풍선 글이 바뀐다")
            check(db2.get(ChatAttachment, atts[1].id) is None and photos_with(db2, p1) == [] and p1 in removed, "지운 한 장은 첨부·사진 페이지·저장소에서 모두 사라진다")
            check(db2.get(ChatAttachment, atts[0].id) is not None, "나머지 사진의 첨부는 그대로다")
            check(raises(422, lambda: chat.remove_photos(11, msg.id, chat.RemovePhotosIn(attachment_ids=[atts[1].id]), m2, u2, db2)), "이미 빠진 사진을 또 지우려 하면 거절한다")
            check(raises(403, lambda: chat.remove_photos(11, msg.id, chat.RemovePhotosIn(attachment_ids=[atts[0].id]), m3, u3, db3)), "남의 묶음에서는 사진을 지울 수 없다")
            res = chat.remove_photos(11, msg.id, chat.RemovePhotosIn(attachment_ids=[atts[0].id]), m1, u1, db1)  # 방장
            check(res["remaining"] == [atts[2].id] and "📷 사진\n" in db2.get(chat.Message, msg.id).text.replace("  ", " "), "방장은 남의 묶음에서도 지울 수 있고 한 장이 남으면 '사진'이 된다")
            res = chat.remove_photos(11, msg.id, chat.RemovePhotosIn(attachment_ids=[atts[2].id]), m2, u2, db2)
            check(res["message_deleted"] is True and not alive(db2, msg.id), "마지막 한 장까지 지우면 말풍선도 사라진다")
            msg, atts = bundle3(db2, u2, m2)
            res = chat.remove_photos(11, msg.id, chat.RemovePhotosIn(attachment_ids=[a.id for a in atts]), m2, u2, db2)
            check(res["message_deleted"] is True and not alive(db2, msg.id), "여러 장을 한꺼번에 골라 전부 지우면 말풍선도 사라진다")
            msg, atts = bundle3(db2, u2, m2)
            res = chat.remove_photos(11, msg.id, chat.RemovePhotosIn(attachment_ids=[atts[0].id, atts[2].id]), m2, u2, db2)
            check(res["remaining"] == [atts[1].id], "여러 장을 한꺼번에 골라 일부만 지울 수 있다")
            chat.delete_message(11, msg.id, m2, u2, db2)

            # 1) 채팅에서 사진 메시지를 지우면 사진 페이지의 사진·첨부·파일도 함께 지워진다
            msg, att, path = chat_photo(db2, u2, m2)
            check(len(photos_with(db2, path)) == 1, "채팅 사진은 사진 페이지에도 들어간다")
            chat.delete_message(11, msg.id, m2, u2, db2)
            check(not alive(db2, msg.id), "채팅에서 지우면 말풍선이 사라진다")
            check(photos_with(db2, path) == [], "채팅에서 지우면 사진 페이지의 사진도 사라진다")
            check(db2.get(ChatAttachment, att.id) is None, "채팅에서 지우면 첨부 기록도 사라진다")
            check(path in removed, "채팅에서 지우면 저장소 파일도 지워진다")

            # 2) 사진 페이지에서 채팅 사진을 지우면 채팅 말풍선도 함께 지워진다
            msg, att, path = chat_photo(db2, u2, m2, "d.png")
            batch = photos_with(db2, path)[0].batch_id
            photo_api.delete_batch(11, batch, m2, u2, db2)
            check(not alive(db2, msg.id), "사진 페이지에서 지우면 채팅 말풍선도 사라진다")
            check(db2.get(ChatAttachment, att.id) is None, "사진 페이지에서 지우면 첨부 기록도 사라진다")
            check(path in removed, "사진 페이지에서 지우면 저장소 파일도 지워진다")

            # 3) 직접 올린 사진(채팅과 무관)은 그냥 그 사진만 지워진다
            up = photo_api.upload_photos(11, [png("u1.png"), png("u2.png")], [], "", "", None, None, None, None, None, None, 0, m2, u2, db2)
            keep_msg, keep_att, keep_path = chat_photo(db2, u2, m2, "keep.png")
            photo_api.delete_batch(11, up[0].batch_id, m2, u2, db2)
            check(alive(db2, keep_msg.id) and len(photos_with(db2, keep_path)) == 1, "다른 사진/메시지는 건드리지 않는다")

            # 4) 남의 사진은 못 지우고 (403), 방장은 지울 수 있다. 연결된 것도 함께.
            msg, att, path = chat_photo(db2, u2, m2, "e.png")
            batch = photos_with(db2, path)[0].batch_id
            check(raises(403, lambda: photo_api.delete_batch(11, batch, m3, u3, db3)), "남의 사진은 삭제 못 한다")
            check(raises(403, lambda: chat.delete_message(11, msg.id, m3, u3, db3)), "남의 사진 메시지는 삭제 못 한다")
            check(alive(db2, msg.id) and len(photos_with(db2, path)) == 1, "권한이 없으면 아무것도 지워지지 않는다")
            photo_api.delete_batch(11, batch, m1, u1, db1)
            check(not alive(db1, msg.id) and photos_with(db1, path) == [], "방장은 남의 채팅 사진도 양쪽에서 지울 수 있다")

            # 5) 저장소 삭제가 실패하면 DB 는 그대로 남는다
            msg, att, path = chat_photo(db2, u2, m2, "f.png")
            state["fail_remove"] = True
            check(raises(502, lambda: chat.delete_message(11, msg.id, m2, u2, db2)), "저장소 오류는 502")
            db2.rollback()
            check(alive(db2, msg.id) and len(photos_with(db2, path)) == 1, "저장소 오류면 기록은 그대로 남는다")
            state["fail_remove"] = False

            # 6) 채팅 메시지 여러 개 선택 삭제
            a, _, pa = chat_photo(db2, u2, m2, "g1.png")
            b = chat.send_message(11, chat.MessageIn(text="안녕"), m2, u2, db2)
            c = chat.send_message(11, chat.MessageIn(text="남의 글"), m3, u3, db3)
            res = chat.bulk_delete_messages(11, chat.BulkDeleteIn(ids=[a.id, b.id, c.id, 999999]), m2, u2, db2)
            check(sorted(res["deleted"]) == sorted([a.id, b.id, 999999]), "내 메시지와 이미 없는 번호는 지운 것으로 돌려준다")
            check(res["skipped"] == [c.id], "남의 메시지는 건너뛴다")
            check(not alive(db2, a.id) and not alive(db2, b.id) and alive(db2, c.id), "여러 개 삭제가 적용된다")
            check(photos_with(db2, pa) == [], "여러 개 삭제에서도 사진 페이지의 사진이 함께 지워진다")
            res = chat.bulk_delete_messages(11, chat.BulkDeleteIn(ids=[c.id]), m1, u1, db1)
            check(res["deleted"] == [c.id] and res["skipped"] == [], "방장은 남의 메시지도 여러 개 삭제할 수 있다")
            from pydantic import ValidationError

            def empty_ids():
                try:
                    chat.BulkDeleteIn(ids=[])
                except ValidationError:
                    return True
                return False

            check(empty_ids(), "빈 목록은 요청 모델이 막는다")

            # 7) 사진 묶음 여러 개 선택 삭제
            m_a, _, p_a = chat_photo(db2, u2, m2, "h1.png")
            up_b = photo_api.upload_photos(11, [png("h2.png"), png("h3.png")], [], "", "", None, None, None, None, None, None, 0, m2, u2, db2)
            other = photo_api.upload_photos(11, [png("h4.png")], [], "", "", None, None, None, None, None, None, 0, m3, u3, db3)
            batch_a = photos_with(db2, p_a)[0].batch_id
            res = photo_api.bulk_delete_batches(
                11, photo_api.BulkBatchDeleteIn(batch_ids=[batch_a, up_b[0].batch_id, other[0].batch_id, "no-such"]), m2, u2, db2
            )
            check(sorted(res["deleted"]) == sorted([batch_a, up_b[0].batch_id, "no-such"]), "내 묶음과 이미 없는 묶음은 지운 것으로 돌려준다")
            check(res["skipped"] == [other[0].batch_id], "남의 묶음은 건너뛴다")
            check(not alive(db2, m_a.id), "묶음 여러 개 삭제에서도 연결된 채팅 말풍선이 지워진다")
            check(photos_with(db2, p_a) == [] and db2.scalar(select(Photo).where(Photo.id == other[0].id)) is not None, "내 것만 지워지고 남의 것은 남는다")

            # 8) 다른 그룹 번호로는 아무것도 못 지운다
            dbx, ux, mx = ctx(3, 12)
            m_other, _, p_other = chat_photo(db2, u2, m2, "i.png")
            res = chat.bulk_delete_messages(12, chat.BulkDeleteIn(ids=[m_other.id]), mx, ux, dbx)
            check(alive(db2, m_other.id) and len(photos_with(db2, p_other)) == 1, "다른 그룹에서는 지워지지 않는다")
            dbx.close()

            # 9) 남아 있는 메시지 번호 목록 (열려 있는 채팅이 지워진 것을 치우는 데 쓴다)
            alive_ids = chat.list_message_ids(11, 0, m1, db1)
            real = set(db1.scalars(select(chat.Message.id).where(chat.Message.group_id == 11)))  # (SQLite 는 지운 번호를 다시 쓸 수 있어 직접 비교한다)
            check(set(alive_ids) == real and m_other.id in alive_ids, "번호 목록에는 지금 남은 메시지만 있다")
            check(chat.list_message_ids(11, m_other.id, m1, db1)[0] == m_other.id, "min_id 이상만 돌려준다")


            # 10) 묶어서 보낸 사진 (한 말풍선에 attach:1,2,3)
            from app.linked_delete import attach_ids_of

            check(attach_ids_of("📷 사진 3장\nattach:4,5,6") == [4, 5, 6], "묶음 번호를 읽는다")
            check(attach_ids_of("attach:7") == [7] and attach_ids_of("안녕") == [] and attach_ids_of("attach:1,a") == [], "한 장 / 일반 글 / 잘못된 글")

            def bundle(db, u, m, n=3):
                atts = [chat_files.upload_chat_file(11, png(f"b{i}.png"), "image", m, u, db) for i in range(n)]
                ids = [a.id for a in atts]
                msg = chat.send_message(11, chat.MessageIn(text=f"📷 사진 {n}장\nattach:{','.join(map(str, ids))}"), m, u, db)
                paths = [db.get(ChatAttachment, i).storage_path for i in ids]
                return msg, ids, paths

            bmsg, bids, bpaths = bundle(db2, u2, m2)
            check(all(len(photos_with(db2, p)) == 1 for p in bpaths), "묶음의 사진은 모두 사진 페이지에도 들어간다")
            chat.delete_message(11, bmsg.id, m2, u2, db2)
            check(not alive(db2, bmsg.id), "묶음 말풍선을 지우면 말풍선이 사라진다")
            check(all(photos_with(db2, p) == [] for p in bpaths) and all(db2.get(ChatAttachment, i) is None for i in bids), "묶음 안의 사진이 전부 사진 페이지에서도 지워진다")
            check(all(p in removed for p in bpaths), "묶음 안의 파일이 전부 저장소에서 지워진다")

            # 사진 페이지에서 묶음 중 한 장만 지우면, 말풍선에서 그 장만 빠진다
            bmsg, bids, bpaths = bundle(db2, u2, m2)
            one = photos_with(db2, bpaths[1])[0].batch_id
            photo_api.delete_batch(11, one, m2, u2, db2)
            db2.expire_all()
            left = db2.get(chat.Message, bmsg.id)
            check(left is not None and left.text == f"📷 사진 2장\nattach:{bids[0]},{bids[2]}", "한 장을 지우면 말풍선에는 남은 사진만 남는다")
            photo_api.delete_batch(11, photos_with(db2, bpaths[0])[0].batch_id, m2, u2, db2)
            db2.expire_all()
            left = db2.get(chat.Message, bmsg.id)
            check(left is not None and left.text == f"📷 사진\nattach:{bids[2]}", "두 장을 지우면 한 장짜리 말풍선이 된다")
            photo_api.delete_batch(11, photos_with(db2, bpaths[2])[0].batch_id, m2, u2, db2)
            check(not alive(db2, bmsg.id), "마지막 한 장까지 지우면 말풍선도 사라진다")

            # 묶음 말풍선을 여러 개 선택 삭제
            b1, _, p1 = bundle(db2, u2, m2, 2)
            b2, _, p2 = bundle(db2, u2, m2, 2)
            res = chat.bulk_delete_messages(11, chat.BulkDeleteIn(ids=[b1.id, b2.id]), m2, u2, db2)
            check(sorted(res["deleted"]) == sorted([b1.id, b2.id]) and all(photos_with(db2, x) == [] for x in p1 + p2), "묶음 말풍선 여러 개를 선택해서 지워도 사진이 함께 지워진다")

            # 남의 묶음은 못 지우고, 방장은 지울 수 있다
            b3, _, p3 = bundle(db2, u2, m2, 2)
            check(raises(403, lambda: chat.delete_message(11, b3.id, m3, u3, db3)), "남의 묶음 말풍선은 지울 수 없다")
            check(all(len(photos_with(db2, x)) == 1 for x in p3), "권한이 없으면 묶음의 사진도 그대로다")
            chat.delete_message(11, b3.id, m1, u1, db1)
            check(not alive(db1, b3.id) and all(photos_with(db1, x) == [] for x in p3), "방장은 남의 묶음도 지울 수 있다")

            for d in (db1, db2, db3):
                d.close()
        engine.dispose()
    print(f"\n{checks} checks passed")


if __name__ == "__main__":
    main()
