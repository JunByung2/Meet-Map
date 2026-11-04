"""속도 개선(캐시) 검증. 임시 SQLite + 가짜 HTTP 만 쓰고 공유 DB/Supabase 에는 접속하지 않는다.
backend 폴더에서:  python tests/test_perf_cache.py
"""
import os
import sys
from pathlib import Path
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["ALLOW_DEV_AUTH"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app import records_sync, storage

checks = 0


def check(cond, label):
    global checks
    if not cond:
        raise SystemExit(f"FAIL {label}")
    checks += 1
    print(f"PASS {label}")


class FakeResponse:
    status_code = 200

    def __init__(self, paths, n):
        self._paths = paths
        self._n = n

    def json(self):
        return [{"path": p, "signedURL": f"/object/sign/b/{p}?token=t{self._n}"} for p in self._paths]


def main():
    # ---- 임시 주소 캐시 ----
    storage.clear_signed_cache()
    calls = []

    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append(list(json["paths"]))
        return FakeResponse(json["paths"], len(calls))

    with patch.object(storage._client, "post", fake_post):
        a = storage.signed_urls(["p/1", "p/2"])
        check(len(calls) == 1 and set(a) == {"p/1", "p/2"}, "처음에는 저장소에 한 번 요청한다")
        b = storage.signed_urls(["p/1", "p/2"])
        check(len(calls) == 1 and b == a, "같은 사진은 저장소에 다시 묻지 않고 같은 주소를 준다")
        c = storage.signed_urls(["p/2", "p/3", "p/3"])
        check(len(calls) == 2 and calls[1] == ["p/3"] and c["p/2"] == a["p/2"], "새 사진만 저장소에 요청한다 (중복 경로는 한 번만)")
        check(storage.signed_urls([]) == {}, "빈 목록은 요청하지 않는다")

        # 지운 사진은 기억에서 지운다
        def fake_delete(method, url, json=None, headers=None, timeout=None):
            return FakeResponse([], 0)

        with patch.object(storage._client, "request", fake_delete):
            storage.remove(["p/1"])
        d = storage.signed_urls(["p/1"])
        check(len(calls) == 3 and d["p/1"] != a["p/1"], "사진을 지우면 임시 주소 기억도 지운다")

        # 만료 직전 주소는 다시 받는다
        with patch.object(storage, "PHOTO_SIGNED_URL_SECONDS", 1):
            storage.clear_signed_cache()
            storage.signed_urls(["q/1"])
            n = len(calls)
        real_now = storage.time.monotonic  # 바꾸기 전의 진짜 시계

        with patch.object(storage.time, "monotonic", lambda: real_now() + 3600):
            storage.signed_urls(["q/1"])
        check(len(calls) == n + 1, "유효시간이 지나면 새 주소를 받는다")

    # ---- meetings 표 구조 기억 (PostgreSQL 일 때만) ----
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE meetings (id INTEGER PRIMARY KEY, group_id INTEGER, title TEXT)"))

    inspected = []
    real_inspect = records_sync.inspect

    def counting_inspect(bind):
        inspected.append(1)
        return real_inspect(bind)

    with patch.object(records_sync, "inspect", counting_inspect):
        records_sync.clear_columns_cache()
        with Session(engine) as db:
            c1 = records_sync._meetings_columns(db)
            c2 = records_sync._meetings_columns(db)
        check(c1 == {"id", "group_id", "title"} and c1 == c2 and len(inspected) == 2, "SQLite 는 기억하지 않고 매번 읽는다 (검증용 DB 동작 그대로)")

        inspected.clear()
        engine.dialect.name = "postgresql"  # PostgreSQL 인 것처럼 보이게 한다
        try:
            with Session(engine) as db:
                records_sync._meetings_columns(db)
                records_sync._meetings_columns(db)
                records_sync._meetings_columns(db)
            check(len(inspected) == 1, "PostgreSQL 에서는 표 구조를 한 번만 읽고 기억한다")

            real_monotonic = records_sync.time.monotonic
            with patch.object(records_sync.time, "monotonic", lambda: real_monotonic() + records_sync._COLUMNS_TTL_SECONDS + 1):
                with Session(engine) as db:
                    records_sync._meetings_columns(db)
            check(len(inspected) == 2, "기억해 둔 시간이 지나면 다시 읽는다")
        finally:
            engine.dialect.name = "sqlite"
            records_sync.clear_columns_cache()

    # meetings 표가 없으면 None
    empty = create_engine("sqlite://")
    with Session(empty) as db:
        check(records_sync._meetings_columns(db) is None, "meetings 표가 없으면 None")
        check(records_sync.load_confirmed_meetings(db, 1) == [], "표가 없어도 기록 기능은 멈추지 않는다")

    print(f"\n{checks} checks passed")


if __name__ == "__main__":
    main()
