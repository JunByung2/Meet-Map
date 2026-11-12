"""사진 달력의 '그날 대표 사진' API 검증. 임시 SQLite 만 쓰고 공유 DB/Supabase 에는 접속하지 않는다.
backend 폴더에서:  python tests/test_day_covers.py
"""
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["ALLOW_DEV_AUTH"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session

from app.db import Base
from app.deps.auth import require_group_member
from app.models import Group, GroupMember, Photo, PhotoDayCover, User
from app.records_sync import KST
from app.routers import messages as _messages_model  # noqa: F401  (messages 표를 Base 에 등록)
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


def raises(code, fn):
    try:
        fn()
    except HTTPException as e:
        return e.status_code == code
    return False


def photo(group, user, batch, order, when, pid):
    return Photo(
        id=pid, group_id=group, user_id=user, storage_path=f"groups/{group}/photos/{pid}/original.png",
        batch_id=batch, sort_order=order, created_at=when,
    )


def main():
    with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as tmp:
        engine = create_engine(f"sqlite:///{Path(tmp) / 't.sqlite'}", connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            db.add_all([User(id=i, nickname=f"m{i}", status="active") for i in (1, 2, 3)])
            db.flush()
            db.add_all([Group(id=11, name="g11", created_by=1), Group(id=12, name="g12", created_by=3)])
            db.flush()
            db.add_all(GroupMember(group_id=g, user_id=u, role=r) for g, u, r in ((11, 1, "owner"), (11, 2, "member"), (12, 3, "owner")))
            db.add_all([
                # 11/2 (한국 시간): 묶음 A(1번이 올림, 사진 2장)가 먼저, 묶음 B(1번)가 나중
                photo(11, 1, "A", 0, datetime(2026, 11, 2, 10, 0, tzinfo=KST), 1),
                photo(11, 1, "A", 1, datetime(2026, 11, 2, 10, 0, tzinfo=KST), 2),
                photo(11, 1, "B", 0, datetime(2026, 11, 2, 15, 0, tzinfo=KST), 3),
                # 날짜 경계를 걸친 묶음: 첫 사진은 11/3 23:59, 둘째는 11/4 00:01 → 묶음은 11/3 에 속한다
                photo(11, 1, "D", 0, datetime(2026, 11, 3, 23, 59, tzinfo=KST), 4),
                photo(11, 1, "D", 1, datetime(2026, 11, 4, 0, 1, tzinfo=KST), 5),
                photo(12, 3, "Z", 0, datetime(2026, 11, 2, 10, 0, tzinfo=KST), 6),
            ])
            db.commit()

        def ctx(user, group):
            db = Session(engine, expire_on_commit=False)
            u = db.get(User, user)
            m = require_group_member(group, u, db)
            return db, u, m

        db, u, m = ctx(2, 11)  # 올린 사람도 방장도 아닌 일반 팀원
        check(photo_api.list_day_covers(11, m, db) == [], "처음에는 정해 둔 대표 사진이 없다 (기본은 그날 첫 사진)")

        out = photo_api.set_day_cover(11, 3, m, u, db)
        check(out.day == "2026-11-02" and out.photo_id == 3, "일반 팀원도 남이 올린 사진을 대표로 정할 수 있다")
        check([(c.day, c.photo_id) for c in photo_api.list_day_covers(11, m, db)] == [("2026-11-02", 3)], "목록에 보인다")

        photo_api.set_day_cover(11, 2, m, u, db)
        covers = photo_api.list_day_covers(11, m, db)
        check([(c.day, c.photo_id) for c in covers] == [("2026-11-02", 2)], "같은 날 다시 정하면 바뀐다 (한 날에 하나)")

        out = photo_api.set_day_cover(11, 5, m, u, db)
        check(out.day == "2026-11-03", "묶음의 둘째 사진이 다음 날 0시에 올라왔어도 묶음의 첫 사진 날짜로 정해진다")

        check(raises(404, lambda: photo_api.set_day_cover(11, 6, m, u, db)), "다른 그룹 사진은 404")
        db.close()
        check(raises(403, lambda: ctx(3, 11)), "그룹 멤버가 아니면 403")

        db, u, m = ctx(3, 12)
        check(photo_api.list_day_covers(12, m, db) == [], "다른 그룹의 대표 사진은 보이지 않는다")
        db.close()

        db, u, m = ctx(1, 11)
        # 대표로 정한 사진이 지워지면 목록에서 빠진다 (그날은 다시 첫 사진이 대표)
        db.delete(db.get(Photo, 5))
        db.commit()
        days = [c.day for c in photo_api.list_day_covers(11, m, db)]
        check(days == ["2026-11-02"], "대표 사진이 지워지면 그 날짜는 목록에서 빠진다")

        check(raises(422, lambda: photo_api.reset_day_cover(11, "2026/11/02", m, db)), "날짜 형식이 틀리면 422")
        resp = photo_api.reset_day_cover(11, "2026-11-02", m, db)
        check(resp.status_code == 204 and photo_api.list_day_covers(11, m, db) == [], "기본으로 되돌리면 목록에서 사라진다")
        photo_api.reset_day_cover(11, "2026-11-02", m, db)  # 이미 없어도 오류 없이 끝난다
        check(db.query(PhotoDayCover).count() == 1, "되돌리기는 그 날짜만 지운다 (다른 날 행은 그대로)")
        db.close()
        engine.dispose()
    print(f"\n{checks} checks passed")


if __name__ == "__main__":
    main()
