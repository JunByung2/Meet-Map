"""비밀번호 해시 + 세션 토큰 유틸"""
import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_ph = PasswordHasher()  # argon2id (솔트는 자동 생성되어 해시 문자열 안에 포함됨)

# 없는 이메일로 로그인할 때도 똑같이 해시 검증을 한 번 해서, 응답 시간으로 가입 여부를 알아내지 못하게 한다.
_DUMMY_HASH = _ph.hash("dummy-password-for-timing")


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    """password_hash 가 None(소셜 가입자 등)이면 더미 해시로 시간만 맞추고 False."""
    if not password_hash:
        try:
            _ph.verify(_DUMMY_HASH, password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            pass
        return False
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def new_session_token() -> str:
    """쿠키에 담아 브라우저에 줄 랜덤 토큰 (추측 불가능)."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """DB 에는 토큰 원문이 아니라 SHA-256 해시(64자)만 저장한다. DB 가 유출돼도 세션을 가로챌 수 없다."""
    return hashlib.sha256(token.encode()).hexdigest()