import logging
import threading

from fastapi import Depends, FastAPI
from sqlalchemy import text

from app import models  # noqa: F401 (테이블 정의 등록)
from app.config import ALLOW_DEV_AUTH
from app.db import Base, engine
from app.deps.auth import get_current_user
from app.routers import (
    account,
    auth,
    avatar,
    chat_files,
    group_members,
    groups,
    invites,
    location,
    messages,
    oauth,
    photos,
    meetings,
    records,
)

# 장소 추천 / 이동 도우미
from meeting_tools.api import router as meeting_router
from meeting_tools.planning.routes import router as place_plan_router
from meeting_tools.transit.routes import router as transit_map_router
from meeting_tools.transit.seoul_bus import router as seoul_bus_router

# 추억지도
from memory_api.routes import router as memory_router

logger = logging.getLogger("meetmap")

app = FastAPI(title="MeetMap API")

app.include_router(auth.router)
app.include_router(account.router)
app.include_router(avatar.router)
app.include_router(oauth.router)
app.include_router(groups.router)
app.include_router(group_members.router)
app.include_router(invites.router)
app.include_router(invites.join_router)
app.include_router(photos.router)
app.include_router(records.router)
app.include_router(meetings.router)
app.include_router(messages.router)
app.include_router(chat_files.router)
app.include_router(location.router)
app.include_router(memory_router)

# 추천용 출발지 저장 / 조회
# 라우터 내부에서 로그인 및 그룹 멤버 여부를 확인한다.
app.include_router(place_plan_router)

# 로그인한 사용자만 교통 / 추천 API를 호출할 수 있다.
_login_required = [Depends(get_current_user)]

app.include_router(meeting_router, dependencies=_login_required)
app.include_router(transit_map_router, dependencies=_login_required)
app.include_router(seoul_bus_router, dependencies=_login_required)


# 기존 표에 필요한 컬럼 추가 (PostgreSQL 전용)
_EXTRA_COLUMNS = [
    "ALTER TABLE chat_attachments ADD COLUMN IF NOT EXISTS data BYTEA",
    # 사진 장소
    "ALTER TABLE group_photos ADD COLUMN IF NOT EXISTS place_id VARCHAR(40)",
    "ALTER TABLE group_photos ADD COLUMN IF NOT EXISTS place_name VARCHAR(100)",
    "ALTER TABLE group_photos ADD COLUMN IF NOT EXISTS place_address VARCHAR(200)",
    "ALTER TABLE group_photos ADD COLUMN IF NOT EXISTS place_lat DOUBLE PRECISION",
    "ALTER TABLE group_photos ADD COLUMN IF NOT EXISTS place_lng DOUBLE PRECISION",

    # 사진이 속한 약속 기록
    "ALTER TABLE group_photos ADD COLUMN IF NOT EXISTS record_id BIGINT REFERENCES meeting_records(id) ON DELETE SET NULL",

    # 약속의 그룹과 생성자
    "ALTER TABLE IF EXISTS meetings ADD COLUMN IF NOT EXISTS group_id BIGINT REFERENCES groups(id) ON DELETE CASCADE",
    "ALTER TABLE IF EXISTS meetings ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL",

    # 약속·투표 후보에 카카오 장소 정보
    "ALTER TABLE IF EXISTS meetings ADD COLUMN IF NOT EXISTS place_id VARCHAR(40)",
    "ALTER TABLE IF EXISTS meetings ADD COLUMN IF NOT EXISTS place_address VARCHAR(200)",
    "ALTER TABLE IF EXISTS meetings ADD COLUMN IF NOT EXISTS place_lat DOUBLE PRECISION",
    "ALTER TABLE IF EXISTS meetings ADD COLUMN IF NOT EXISTS place_lng DOUBLE PRECISION",
    "ALTER TABLE IF EXISTS meeting_candidates ADD COLUMN IF NOT EXISTS place_id VARCHAR(40)",
    "ALTER TABLE IF EXISTS meeting_candidates ADD COLUMN IF NOT EXISTS place_address VARCHAR(200)",
    "ALTER TABLE IF EXISTS meeting_candidates ADD COLUMN IF NOT EXISTS place_lat DOUBLE PRECISION",
    "ALTER TABLE IF EXISTS meeting_candidates ADD COLUMN IF NOT EXISTS place_lng DOUBLE PRECISION",

    # 지난 기록 삭제 표시 / 약속을 확정한 사람
    "ALTER TABLE IF EXISTS meeting_records ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE",

    # 채팅방 투표: 후보 묶음 번호 + 확정 상태
    "ALTER TABLE IF EXISTS meeting_candidates ADD COLUMN IF NOT EXISTS poll_id VARCHAR(40)",
    "ALTER TABLE IF EXISTS meeting_candidates ADD COLUMN IF NOT EXISTS closed BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE IF EXISTS meeting_candidates ADD COLUMN IF NOT EXISTS chosen BOOLEAN NOT NULL DEFAULT FALSE",

    # 위치 공유: 브라우저 직접 접근에 RLS 적용
    "ALTER TABLE IF EXISTS location_shares ENABLE ROW LEVEL SECURITY",
]


# 약속 하나에 기록 하나. 예전 데이터에 중복이 있으면 실패할 수 있어서 위 명령들과 따로 실행한다.
_EXTRA_INDEXES = [
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_records_group_meeting ON meeting_records (group_id, meeting_id)",
]


def _prepare_tables() -> None:
    """없는 테이블과 필요한 컬럼을 확인한다."""
    try:
        Base.metadata.create_all(engine)

        if engine.dialect.name == "postgresql":
            with engine.begin() as conn:
                for sql in _EXTRA_COLUMNS:
                    conn.execute(text(sql))

            for sql in _EXTRA_INDEXES:
                try:
                    with engine.begin() as conn:
                        conn.execute(text(sql))
                except Exception as e:  # noqa: BLE001
                    logger.error("인덱스 생성 건너뜀: %s", e)

        logger.warning(
            "DB 테이블 확인 완료 (사진 장소 + 약속 기록 + 약속 group_id + 위치 공유)"
        )

    except Exception as e:  # noqa: BLE001
        logger.error("DB 테이블 생성/확인 실패: %s", e)


def _cleanup_locations() -> None:
    """만료됐거나 중단된 위치 공유를 1분마다 삭제한다."""
    if engine.dialect.name != "postgresql":
        return

    waiter = threading.Event()

    while not waiter.wait(60):
        try:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "DELETE FROM location_shares "
                        "WHERE expires_at <= NOW() "
                        "OR stopped_at IS NOT NULL"
                    )
                )

        except Exception as e:  # noqa: BLE001
            logger.error("위치 정리 작업 실패: %s", e)


threading.Thread(target=_prepare_tables, daemon=True).start()
threading.Thread(target=_cleanup_locations, daemon=True).start()


if ALLOW_DEV_AUTH:
    logger.warning(
        "⚠ ALLOW_DEV_AUTH=true: X-User-Id 임시 인증이 켜져 있습니다. "
        "개발 환경에서만 사용하세요."
    )

    from app.routers import dev

    app.include_router(dev.router)


@app.get("/health")
def health():
    return {"status": "ok"}