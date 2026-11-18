"""웹 공격 방어(로그인 시도 제한, 출처 검사, 보안 헤더, 비밀번호 강도, API 문서 숨김) 검증.
임시 SQLite 파일만 쓰고 실제 DB나 외부 API에는 접속하지 않는다.
backend 폴더에서:  python tests/test_hardening.py
"""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/t.db"
os.environ["ALLOW_DEV_AUTH"] = "false"
os.environ["FRONTEND_URL"] = "http://localhost:3000"
os.environ.pop("ENABLE_DOCS", None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import BigInteger
from sqlalchemy.ext.compiler import compiles

from app.db import Base, engine
from app.main import app
from app.ratelimit import limiter
from app.schemas import check_password_strength


@compiles(BigInteger, "sqlite")
def _sqlite_big_integer(element, compiler, **kw):
    return "INTEGER"


OK = {"origin": "http://localhost:3000"}
EVIL = {"origin": "https://evil.example"}


def signup(client, email, password="Good-pass-1", headers=OK):
    return client.post("/auth/signup", headers=headers,
                       json={"email": email, "password": password, "nickname": "tester"})


class HardeningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        time.sleep(0.3)  # 서버 시작 시 백그라운드 테이블 준비와 겹치지 않게
        Base.metadata.create_all(engine)
        cls.client = TestClient(app)

    def setUp(self):
        limiter.clear()

    def test_weak_passwords_are_rejected(self):
        for weak in ("12345678", "abcdefgh", "password123", "aaaaaaa1"):
            self.assertNotEqual(check_password_strength(weak), "", weak)
        self.assertEqual(check_password_strength("Good-pass-1"), "")
        self.assertEqual(check_password_strength("meetmap-2026"), "")
        r = signup(self.client, "weak@example.com", "12345678")
        self.assertEqual(r.status_code, 422)

    def test_signup_and_login_work_normally(self):
        self.assertEqual(signup(self.client, "ok@example.com").status_code, 201)
        r = self.client.post("/auth/login", headers=OK, json={"email": "ok@example.com", "password": "Good-pass-1"})
        self.assertEqual(r.status_code, 200)
        self.assertIn("session_id", r.cookies)

    def test_login_is_locked_after_repeated_failures_even_with_right_password(self):
        signup(self.client, "lock@example.com")
        for _ in range(10):
            r = self.client.post("/auth/login", headers=OK, json={"email": "lock@example.com", "password": "wrong-pass-1"})
            self.assertEqual(r.status_code, 401)
        r = self.client.post("/auth/login", headers=OK, json={"email": "lock@example.com", "password": "Good-pass-1"})
        self.assertEqual(r.status_code, 429)
        self.assertIn("retry-after", r.headers)
        # 다른 이메일은 영향받지 않는다
        signup(self.client, "other@example.com")
        r = self.client.post("/auth/login", headers=OK, json={"email": "other@example.com", "password": "Good-pass-1"})
        self.assertEqual(r.status_code, 200)

    def test_successful_login_clears_failure_count(self):
        signup(self.client, "clear@example.com")
        for _ in range(5):
            self.client.post("/auth/login", headers=OK, json={"email": "clear@example.com", "password": "wrong-pass-1"})
        self.assertEqual(self.client.post("/auth/login", headers=OK, json={"email": "clear@example.com", "password": "Good-pass-1"}).status_code, 200)
        for _ in range(9):
            self.client.post("/auth/login", headers=OK, json={"email": "clear@example.com", "password": "wrong-pass-1"})
        self.assertEqual(self.client.post("/auth/login", headers=OK, json={"email": "clear@example.com", "password": "Good-pass-1"}).status_code, 200)

    def test_signup_is_rate_limited_per_address(self):
        codes = [signup(self.client, f"s{i}@example.com").status_code for i in range(12)]
        self.assertEqual(codes[:10], [201] * 10)
        self.assertEqual(codes[10:], [429, 429])

    def test_cross_site_write_requests_are_blocked(self):
        r = self.client.post("/auth/logout", headers=EVIL)
        self.assertEqual(r.status_code, 403)
        r = signup(self.client, "evil@example.com", headers=EVIL)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.client.post("/auth/logout", headers={"origin": "null"}).status_code, 403)

    def test_same_site_and_originless_requests_pass_the_origin_check(self):
        self.assertEqual(self.client.post("/auth/logout", headers=OK).status_code, 204)
        self.assertEqual(self.client.post("/auth/logout", headers={"origin": "http://127.0.0.1:3000"}).status_code, 204)
        self.assertEqual(self.client.post("/auth/logout").status_code, 204)  # 서버끼리 호출 등
        self.assertEqual(self.client.get("/health", headers=EVIL).status_code, 200)  # 읽기 요청은 검사하지 않는다

    def test_security_headers_are_added(self):
        r = self.client.get("/health")
        self.assertEqual(r.headers["x-content-type-options"], "nosniff")
        self.assertEqual(r.headers["x-frame-options"], "DENY")
        self.assertIn("referrer-policy", r.headers)
        me = self.client.get("/auth/me")
        self.assertEqual(me.headers["cache-control"], "no-store")

    def test_api_docs_are_hidden_by_default(self):
        for path in ("/docs", "/redoc", "/openapi.json"):
            self.assertEqual(self.client.get(path).status_code, 404, path)

    def test_forwarded_header_cannot_be_spoofed_to_dodge_the_address_limit(self):
        # 첫 번째 값을 바꿔 가며 보내도, 프록시가 붙인 마지막 값으로 센다
        for i in range(10):
            r = self.client.post("/auth/signup", headers={**OK, "x-forwarded-for": f"9.9.9.{i}, 1.2.3.4"},
                                 json={"email": f"f{i}@example.com", "password": "Good-pass-1", "nickname": "t"})
            self.assertEqual(r.status_code, 201)
        r = self.client.post("/auth/signup", headers={**OK, "x-forwarded-for": "7.7.7.7, 1.2.3.4"},
                             json={"email": "f99@example.com", "password": "Good-pass-1", "nickname": "t"})
        self.assertEqual(r.status_code, 429)

    def test_expensive_endpoints_are_throttled_per_session(self):
        from app.hardening import THROTTLE_RULES
        rule = next(r for r in THROTTLE_RULES if r[4] == "place-recommend")
        _, _, limit, _, _ = rule
        path = "/groups/1/place-plans/abc/recommend"
        cookies = {"session_id": "token-a"}
        codes = [self.client.post(path, headers=OK, cookies=cookies).status_code for _ in range(limit + 2)]
        self.assertTrue(all(c != 429 for c in codes[:limit]))   # 한도 안에서는 (로그인 오류 등으로) 429 가 아니다
        self.assertEqual(codes[limit:], [429, 429])
        # 다른 세션은 영향받지 않는다
        other = self.client.post(path, headers=OK, cookies={"session_id": "token-b"})
        self.assertNotEqual(other.status_code, 429)

    def test_oversized_non_upload_body_is_rejected(self):
        big = "x" * (1024 * 1024 + 10)
        r = self.client.post("/auth/login", headers=OK, content=big, )
        self.assertEqual(r.status_code, 413)
        # 업로드 경로는 이 제한을 받지 않는다
        from app.hardening import UPLOAD_PATH
        for ok in ("/groups/1/chat-files", "/groups/3/photos", "/groups/3/records/5/photos", "/auth/me/avatar"):
            self.assertTrue(UPLOAD_PATH.match(ok), ok)
        for no in ("/auth/login", "/groups/1/messages", "/recommend"):
            self.assertFalse(UPLOAD_PATH.match(no), no)

    def test_normal_endpoints_are_not_throttled(self):
        for _ in range(40):
            self.assertNotEqual(self.client.get("/health").status_code, 429)


if __name__ == "__main__":
    unittest.main()