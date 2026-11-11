"""'내 모든 그룹 추억 모아보기' API 검증. 임시 SQLite 만 쓰고 공유 DB/Supabase 에는 접속하지 않는다.
backend 폴더에서:  python tests/test_me_memories.py
"""
import os
import sys
import tempfile
from datetime import date, datetime
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["ALLOW_DEV_AUTH"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import Response
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session

from app.db import Base
from app.models import Group, GroupMember, MeetingRecord, Photo, User
from app.records_sync import KST
from app.routers import messages as _messages_model  # noqa: F401
from app.routers import me_memories


@compiles(BigInteger, "sqlite")
def sqlite_big_integer(element, compiler, **kw):
    return "INTEGER"


checks = 0


def check(cond, label):
    global checks
    assert cond, label
    checks += 1
    print(f"PASS {label}")


def photo(pid, group, batch, when, place=None):
    p = Photo(id=pid, group_id=group, user_id=1, storage_path=f"groups/{group}/photos/{pid}/o.png",
              batch_id=batch, sort_order=0, created_at=when)
    if place:
        p.place_name, p.place_lat, p.place_lng = place
    return p


def main():
    with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as tmp:
        engine = create_engine(f"sqlite:///{Path(tmp) / 't.sqlite'}", connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            db.add_all([User(id=i, nickname=f"m{i}", status="active") for i in (1, 2)])
            db.flush()
            db.add_all([Group(id=11, name="g11", created_by=1), Group(id=12, name="g12", created_by=1),
                        Group(id=13, name="other", created_by=2)])
            db.flush()
            db.add_all(GroupMember(group_id=g, user_id=u, role="owner") for g, u in ((11, 1), (12, 1), (13, 2)))
            t = lambda d: datetime(2026, 11, d, 10, 0, tzinfo=KST)  # noqa: E731
            db.add_all([
                photo(1, 11, "a", t(1)), photo(2, 12, "b", t(3), ("성수", 37.5, 127.0)),
                photo(3, 13, "c", t(5), ("남의 장소", 37.6, 127.1)), photo(4, 11, "d", t(2), ("홍대", 37.55, 126.9)),
            ])
            db.add_all([
                MeetingRecord(id=1, group_id=11, title="r11", meet_date=date(2026, 10, 1), deleted=False, created_by=1),
                MeetingRecord(id=2, group_id=12, title="r12", meet_date=date(2026, 10, 5), deleted=False, created_by=1),
                MeetingRecord(id=3, group_id=13, title="남의 기록", meet_date=date(2026, 10, 9), deleted=False, created_by=2),
                MeetingRecord(id=4, group_id=11, title="지운 기록", meet_date=date(2026, 10, 7), deleted=True, created_by=1),
            ])
            db.commit()

        with Session(engine, expire_on_commit=False) as db:
            out = me_memories.my_memories(Response(), db.get(User, 1), db)
            check([g.id for g in out.groups] == [11, 12], "내가 속한 그룹만, 번호순")
            check({p.id for p in out.photos} == {1, 2, 4}, "다른 그룹(내가 멤버가 아닌) 사진은 없다")
            check([p.id for p in out.photos] == [2, 4, 1], "사진은 최신순")
            check({p.id for p in out.place_photos} == {2, 4}, "장소 사진만 지도용 목록에 들어간다")
            check([r.id for r in out.records] == [2, 1], "기록은 내 그룹 것만, 지운 기록 제외, 날짜 최신순")
            check(all(p.signed_url is None for p in out.photos), "저장소 설정이 없어도 목록은 나온다")

        with Session(engine, expire_on_commit=False) as db:
            out = me_memories.my_memories(Response(), db.get(User, 2), db)
            check([g.id for g in out.groups] == [13] and [p.id for p in out.photos] == [3], "다른 사람은 자기 그룹 것만 본다")
            db.add(User(id=9, nickname="solo", status="active"))
            db.commit()
            out = me_memories.my_memories(Response(), db.get(User, 9), db)
            check(out.groups == [] and out.photos == [] and out.records == [], "그룹이 없으면 빈 목록")
        engine.dispose()
    print(f"\n{checks} checks passed")


if __name__ == "__main__":
    main()
