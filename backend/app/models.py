from datetime import datetime

from sqlalchemy import (
    BigInteger, CheckConstraint, DateTime, ForeignKey, Integer, String,
    UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# PostgreSQL 에서는 BIGINT(자동 증가), 테스트용 SQLite 에서는 INTEGER 로 동작
BigId = BigInteger().with_variant(Integer, "sqlite")


class User(Base):
    """1. 회원 테이블"""
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    nickname: Mapped[str] = mapped_column(String(30), nullable=False)
    name: Mapped[str | None] = mapped_column(String(50))                # 이름 (소셜에서 못 받으면 비어 있음)
    email: Mapped[str | None] = mapped_column(String(255), unique=True) # 이메일 (선택 동의라 비어 있을 수 있음)
    password: Mapped[str | None] = mapped_column(String(255))           # 비밀번호 해시 (OAuth 가입자는 NULL)
    profile_image: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="active")  # active(정상) / dormant(휴면)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("status IN ('active','dormant')", name="ck_users_status"),
    )


class Group(Base):
    """2. 그룹 테이블 (group은 PostgreSQL 예약어라서 테이블명은 groups)"""
    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    icon: Mapped[str | None] = mapped_column(String(20))
    description: Mapped[str | None] = mapped_column(String(500))
    # 생성자 기록용. 방장 판단은 group_member.role 로 한다. 회원 삭제 시 NULL 로 남김.
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GroupMember(Base):
    """3. 그룹멤버 테이블 — (group_id, user_id) 한 행이 곧 가입 관계"""
    __tablename__ = "group_member"

    group_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    role: Mapped[str] = mapped_column(String(10), nullable=False, default="member")  # owner(방장) / member(멤버)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("role IN ('owner','member')", name="ck_group_member_role"),
    )


class Session(Base):
    """4. 세션저장소 테이블 (실제 세션 로그인 단계에서 사용)"""
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # 쿠키에 담기는 랜덤 세션 id
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Invite(Base):
    """5. 초대 테이블 — 그룹당 유효한 링크는 1개 (재발급 시 기존 링크 회수)"""
    __tablename__ = "invite"

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)  # 원문 대신 SHA-256 해시만 저장
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL")
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    max_uses: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    used_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OAuthAccount(Base):
    """6. 소셜계정 테이블"""
    __tablename__ = "oauth_accounts"

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(10), nullable=False)  # kakao / google
    provider_user_id: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("provider", "provider_user_id", name="uq_oauth_provider_user"),
        CheckConstraint("provider IN ('kakao','google')", name="ck_oauth_provider"),
    )