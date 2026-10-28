from datetime import date, datetime

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Date, DateTime, Float, ForeignKey, Integer, LargeBinary, String,
    UniqueConstraint, false, func,
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


class Photo(Base):
    """7. 사진 테이블(group_photos) — 그룹 단위로 보관한다. 파일 본체는 Supabase Storage(비공개 버킷)에 있다."""
    __tablename__ = "group_photos"

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 올린 사람. 회원이 탈퇴해도 사진은 그룹에 남기므로 NULL 로 둔다.
    user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    meeting_id: Mapped[int | None] = mapped_column(BigInteger)  # 약속 연결(약속 기능이 생기면 FK 로 바꾼다)
    # 이 사진이 속한 약속 기록 (기록 없이 올린 사진은 NULL). 기록을 지워도 사진은 갤러리에 남는다.
    record_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("meeting_records.id", ondelete="SET NULL"), index=True
    )
    # 예: groups/12/photos/{uuid}/original.png  (같은 경로 중복 불가)
    storage_path: Mapped[str] = mapped_column(String(300), nullable=False, unique=True)
    url: Mapped[str | None] = mapped_column(String(600))      # 고정 주소(기록용). 비공개 버킷이라 직접 열리지는 않는다.
    caption: Mapped[str | None] = mapped_column(String(200))  # 사진 한 장마다의 설명
    title: Mapped[str | None] = mapped_column(String(60))     # 함께 올린 묶음의 제목
    memo: Mapped[str | None] = mapped_column(String(500))     # 함께 올린 묶음의 한마디 메모
    batch_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)  # 한 번에 올린 사진끼리 같은 값
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 찍은 장소 (선택). 같은 묶음의 사진은 같은 장소를 가진다. 추억지도에 이 좌표로 마커가 찍힌다.
    place_id: Mapped[str | None] = mapped_column(String(40))        # 카카오 장소 id (같은 장소끼리 묶을 때 사용)
    place_name: Mapped[str | None] = mapped_column(String(100))
    place_address: Mapped[str | None] = mapped_column(String(200))
    place_lat: Mapped[float | None] = mapped_column(Float)          # 위도
    place_lng: Mapped[float | None] = mapped_column(Float)          # 경도
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MeetingRecord(Base):
    """8. 약속 기록 테이블(meeting_records) — '그날 무엇을 했는지' 날짜·장소·참여자·한 줄 문구를 남긴다."""
    __tablename__ = "meeting_records"

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 기록한 사람. 회원이 탈퇴해도 기록은 그룹에 남긴다.
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    # 연결한 약속 번호 (약속 목록에서 골랐을 때만). 약속 표가 아직 없어도 기록은 따로 저장된다.
    meeting_id: Mapped[int | None] = mapped_column(BigInteger)
    title: Mapped[str] = mapped_column(String(60), nullable=False)  # 약속 이름
    meet_date: Mapped[date] = mapped_column(Date, nullable=False)  # 약속 날짜
    # 장소 (선택). 사진과 같은 모양이라 추억지도 장소와 맞출 수 있다.
    place_id: Mapped[str | None] = mapped_column(String(40))
    place_name: Mapped[str | None] = mapped_column(String(100))
    place_address: Mapped[str | None] = mapped_column(String(200))
    place_lat: Mapped[float | None] = mapped_column(Float)
    place_lng: Mapped[float | None] = mapped_column(Float)
    note: Mapped[str | None] = mapped_column(String(100))  # 한 줄 문구
    # 사용자가 지운 기록. 확정된 약속이 그대로 있어도 자동으로 다시 만들어지지 않게 흔적만 남긴다.
    deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # 약속 하나에 기록은 하나만 (두 사람이 동시에 열어도 중복 생성 안 됨)
    __table_args__ = (UniqueConstraint("group_id", "meeting_id", name="uq_meeting_records_group_meeting"),)


class Meeting(Base):
    """그룹별 약속"""
    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(
        BigId, primary_key=True, autoincrement=True
    )
    group_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("groups.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    location: Mapped[str] = mapped_column(String(200), nullable=False)
    meeting_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    # 카카오 장소 검색으로 고른 장소 (선택). location 에는 장소 이름이 들어간다.
    place_id: Mapped[str | None] = mapped_column(String(40))
    place_address: Mapped[str | None] = mapped_column(String(200))
    place_lat: Mapped[float | None] = mapped_column(Float)
    place_lng: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="confirmed"
    )
    # 약속을 확정한 사람(투표를 만든 사람). 이 사람과 방장이 약속을 삭제할 수 있다. 예전 약속은 NULL.
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class MeetingCandidate(Base):
    """약속 투표 후보"""
    __tablename__ = "meeting_candidates"

    id: Mapped[int] = mapped_column(
        BigId, primary_key=True, autoincrement=True
    )
    group_id: Mapped[int] = mapped_column(
        BigId,
        ForeignKey("groups.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    location: Mapped[str] = mapped_column(String(200), nullable=False)
    meeting_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    # 카카오 장소 검색으로 고른 장소 (선택). location 에는 장소 이름이 들어간다.
    place_id: Mapped[str | None] = mapped_column(String(40))
    place_address: Mapped[str | None] = mapped_column(String(200))
    place_lat: Mapped[float | None] = mapped_column(Float)
    place_lng: Mapped[float | None] = mapped_column(Float)
    created_by: Mapped[int] = mapped_column(
        BigId,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    # 채팅방에서 한 번에 만든 투표(후보 묶음) 번호. 없으면(예전 후보) 그룹 전체가 한 묶음이다.
    poll_id: Mapped[str | None] = mapped_column(String(40), index=True)
    closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())  # 확정돼서 끝난 투표
    chosen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())  # 확정된 후보
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class MeetingVote(Base):
    """사용자별 약속 후보 투표"""
    __tablename__ = "meeting_votes"

    id: Mapped[int] = mapped_column(
        BigId, primary_key=True, autoincrement=True
    )
    candidate_id: Mapped[int] = mapped_column(
        BigId,
        ForeignKey("meeting_candidates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        BigId,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "candidate_id",
            "user_id",
            name="uq_meeting_vote_candidate_user",
        ),
    )


class ChatAttachment(Base):
    """채팅으로 보낸 사진/파일. 메시지 글(messages.text) 마지막 줄의 `attach:번호` 가 이 행을 가리킨다."""
    __tablename__ = "chat_attachments"

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # image | file
    filename: Mapped[str] = mapped_column(String(200), nullable=False)  # 보낸 사람이 올린 원래 이름(표시용)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    storage_path: Mapped[str] = mapped_column(String(300), nullable=False, unique=True)  # 파일은 'db:번호' (내용은 data 에 저장)
    data: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)  # 문서 파일 내용 (사진은 저장소 사용)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
