"""서버 시작 시 DB 준비 작업 검증. 가짜 DB 상태만 쓰고 공유 DB 에는 접속하지 않는다.
이미 있는 컬럼/인덱스/RLS 는 건드리지 않고(테이블 잠금 방지), 없는 것만 짧게 실행하는지 확인한다.
backend 폴더에서:  python tests/test_startup_prepare.py
"""
import os
import sys
from pathlib import Path
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["ALLOW_DEV_AUTH"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy.ext.compiler import compiles
from sqlalchemy import BigInteger

from app import main as app_main

checks = 0


@compiles(BigInteger, "sqlite")
def sqlite_big_integer(element, compiler, **kw):
    return "INTEGER"


def check(cond, label):
    global checks
    if not cond:
        raise SystemExit(f"FAIL {label}")
    checks += 1
    print(f"PASS {label}")


def all_columns():
    """_EXTRA_COLUMNS 가 만드는 (표, 컬럼) 전부"""
    return {app_main._COLUMN_RE.search(s).groups() for s in app_main._EXTRA_COLUMNS}


def run(existing_columns, rls, indexes):
    ran: list[str] = []
    with patch.object(app_main.engine.dialect, "name", "postgresql"), \
         patch.object(app_main.Base.metadata, "create_all", lambda e: None), \
         patch.object(app_main, "_existing_columns", lambda: existing_columns), \
         patch.object(app_main, "_rls_state", lambda: rls), \
         patch.object(app_main, "_existing_indexes", lambda: indexes), \
         patch.object(app_main, "_run_ddl", lambda sql: ran.append(sql) or True):
        app_main._prepare_tables()
    return ran


def main():
    wanted = all_columns()
    tables = {t for t, _ in wanted}
    existing = set(wanted) | {(t, "id") for t in tables}  # 실제 표에는 id 같은 다른 컬럼도 있다
    index = "uq_meeting_records_group_meeting"

    ran = run(existing, {"location_shares": True}, {index})
    check(ran == [], "전부 이미 있으면 아무 명령도 실행하지 않는다 (테이블을 잠그지 않는다)")

    missing = {("meeting_candidates", "poll_id"), ("chat_attachments", "data")}
    ran = run(existing - missing, {"location_shares": True}, {index})
    check(len(ran) == 2 and all("ADD COLUMN IF NOT EXISTS" in s for s in ran), "없는 컬럼만 실행한다")
    check(any("poll_id" in s for s in ran) and any(" data " in s for s in ran), "빠진 컬럼이 정확히 그것들이다")

    ran = run(existing, {"location_shares": False}, {index})
    check(ran == ["ALTER TABLE location_shares ENABLE ROW LEVEL SECURITY"], "RLS 가 꺼져 있을 때만 켠다")

    ran = run(existing, {"location_shares": True}, set())
    check(len(ran) == 1 and "CREATE UNIQUE INDEX" in ran[0], "인덱스가 없을 때만 만든다")

    # 표 자체가 없으면(IF EXISTS) 건너뛴다
    ran = run({c for c in existing if c[0] != "meetings"}, {"location_shares": True}, {index})
    check(ran == [], "표가 없으면 그 표의 컬럼 명령은 실행하지 않는다")

    # 모든 명령이 정규식으로 인식된다 (새 명령을 잘못 쓰면 여기서 잡힌다)
    check(all(app_main._COLUMN_RE.search(s) for s in app_main._EXTRA_COLUMNS), "모든 컬럼 명령을 인식한다")
    check(len(tables) >= 4, "여러 표를 다룬다")

    # _run_ddl 은 잠금 대기를 짧게 건다
    seen: list[str] = []

    class FakeConn:
        def execute(self, stmt):
            seen.append(str(stmt))

    class FakeBegin:
        def __enter__(self):
            return FakeConn()

        def __exit__(self, *a):
            return False

    with patch.object(app_main.engine, "begin", lambda: FakeBegin()):
        ok = app_main._run_ddl("ALTER TABLE x ADD COLUMN IF NOT EXISTS y INT")
    check(ok and seen[0].startswith("SET LOCAL lock_timeout") and seen[1].startswith("ALTER TABLE x"), "명령 앞에 lock_timeout 을 건다")

    class BoomBegin:
        def __enter__(self):
            raise RuntimeError("lock timeout")

        def __exit__(self, *a):
            return False

    with patch.object(app_main.engine, "begin", lambda: BoomBegin()):
        check(app_main._run_ddl("ALTER TABLE x ADD COLUMN IF NOT EXISTS y INT") is False, "잠겨서 실패해도 서버는 멈추지 않고 넘어간다")

    print(f"\n{checks} checks passed")


if __name__ == "__main__":
    main()
