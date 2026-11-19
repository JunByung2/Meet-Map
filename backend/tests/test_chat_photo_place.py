"""채팅으로 보낸 사진에 촬영 위치(장소)가 같이 저장되는지 검증.
임시 SQLite + 가짜 저장소만 쓰고 공유 DB/Supabase 에는 접속하지 않는다.
backend 폴더에서:  python tests/test_chat_photo_place.py
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
from app.routers import messages as _messages_model  # noqa: F401  (messages 표를 Base 에 등록)


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


def main():
    with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as tmp:
        engine = create_engine(f"sqlite:///{Path(tmp) / 't.sqlite'}", connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            db.add(User(id=1, nickname="m1", status="active"))
            db.flush()
            db.add(Group(id=11, name="g11", created_by=1))
            db.flush()
            db.add(GroupMember(group_id=11, user_id=1, role="owner"))
            db.commit()

        fake = {
            "is_configured": lambda: True,
            "upload": lambda path, data, ct: None,
            "signed_urls": lambda paths: {p: f"https://signed/{p}" for p in paths},
            "remove": lambda paths: None,
        }
        with patch.multiple(storage, **fake):
            db = Session(engine, expire_on_commit=False)
            u = db.get(User, 1)
            m = require_group_member(11, u, db)

            def photo_of(att):
                path = db.get(ChatAttachment, att.id).storage_path
                return db.scalars(select(Photo).where(Photo.storage_path == path)).one()

            # 1) 위치 없이 보내면 예전과 같다 (장소 없음)
            a = chat_files.upload_chat_file(11, png("a.png"), "image", m, u, db)
            p = photo_of(a)
            check(p.place_lat is None and p.place_name is None, "위치 없이 보낸 채팅 사진은 장소가 비어 있다")

            # 2) 위치를 같이 보내면 사진 모음/추억지도용 장소 칸에 저장된다
            a = chat_files.upload_chat_file(
                11, png("b.png"), "image", m, u, db,
                place_name="서울시청", place_address="서울 중구 세종대로 110", place_lat=37.5665, place_lng=126.978,
            )
            p = photo_of(a)
            check(p.place_name == "서울시청" and p.place_address == "서울 중구 세종대로 110", "장소 이름과 주소가 저장된다")
            check(abs(p.place_lat - 37.5665) < 1e-6 and abs(p.place_lng - 126.978) < 1e-6, "위도·경도가 저장된다")
            check(p.place_id is None, "자동으로 읽은 위치는 카카오 장소 번호 없이 저장된다")

            # 3) 이상한 값은 거절한다 (프론트는 422 면 위치 없이 다시 보낸다)
            try:
                chat_files.upload_chat_file(11, png("c.png"), "image", m, u, db, place_name="x", place_lat=999.0, place_lng=126.9)
                bad = False
            except HTTPException as e:
                bad = e.status_code == 422
            check(bad, "범위를 벗어난 좌표는 422 로 거절한다")
            check(db.scalars(select(Photo)).all().__len__() == 2, "거절된 요청은 사진을 남기지 않는다")
    print(f"\n{checks} checks passed")


if __name__ == "__main__":
    main()
