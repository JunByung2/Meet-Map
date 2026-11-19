import re

from pydantic import BaseModel, EmailStr, Field, field_validator


_COMMON_PASSWORDS = {
    "password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123",
    "qwertyuiop", "iloveyou", "11111111", "00000000", "abcd1234", "abc12345", "asdf1234", "1q2w3e4r",
    "meetmap1", "meetmap123", "admin1234", "welcome1", "letmein1",
}


def check_password_strength(password: str) -> str:
    """약한 비밀번호면 이유를 돌려주고, 괜찮으면 빈 문자열을 돌려준다."""
    kinds = sum(bool(re.search(p, password)) for p in (r"[a-zA-Z]", r"\d", r"[^a-zA-Z\d\s]"))
    if kinds < 2:
        return "비밀번호는 영문, 숫자, 특수문자 중 2종류 이상을 섞어 주세요."
    if password.lower() in _COMMON_PASSWORDS or len(set(password)) < 4:
        return "너무 흔하거나 단순한 비밀번호예요. 다른 비밀번호를 사용해 주세요."
    return ""


class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    nickname: str = Field(min_length=1, max_length=30)
    name: str | None = Field(default=None, max_length=50)

    @field_validator("password")
    @classmethod
    def _strong_password(cls, value: str) -> str:
        problem = check_password_strength(value)
        if problem:
            raise ValueError(problem)
        return value


class LoginIn(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(max_length=128)


class UserOut(BaseModel):
    id: int
    nickname: str
    email: str | None = None
    profile_image: str | None = None


class GroupCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    icon: str | None = Field(default=None, max_length=20)
    description: str | None = Field(default=None, max_length=500)


class GroupOut(BaseModel):
    id: int
    name: str
    icon: str | None = None
    description: str | None = None
    role: str  # 내 역할 (owner / member)


class MemberOut(BaseModel):
    user_id: int
    nickname: str
    role: str


class GroupDetailOut(BaseModel):
    id: int
    name: str
    icon: str | None = None
    description: str | None = None
    my_role: str
    members: list[MemberOut]