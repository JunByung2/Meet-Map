from pydantic import BaseModel, EmailStr, Field


class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    nickname: str = Field(min_length=1, max_length=30)
    name: str | None = Field(default=None, max_length=50)


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