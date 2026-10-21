import logging
import threading

from fastapi import Depends, FastAPI
from sqlalchemy import text

from app import models  # noqa: F401  (테이블 정의 등록)
from app.config import ALLOW_DEV_AUTH
from app.db import Base, engine
from app.deps.auth import get_current_user
from app.routers import auth, group_members, groups, invites, location, messages, oauth, photos

# 종은 장소추천/이동도우미 (로그인한 사용자만)
from meeting_tools.api import router as meeting_router
from meeting_tools.transit.routes import router as transit_map_router
from meeting_tools.transit.seoul_bus import router as seoul_bus_router
from memory_api.routes import router as memory_router

logger = logging.getLogger("meetmap")

app = FastAPI(title="MeetMap API")

app.include_router(auth.router)
app.include_router(oauth.router)
app.include_router(groups.router)
app.include_router(group_members.router)
app.include_router(invites.router)
app.include_router(invites.join_router)
app.include_router(photos.router)
app.include_router(messages.router)
app.include_router(location.router)
app.include_router(memory_router)

# 로그인 없이는 호출할 수 없게 라우터 전체에 get_current_user 를 건다.
_login_required = [Depends(get_current_user)]
app.include_router(meeting_router, dependencies=_login_required)
app.include_router(transit_map_router, dependencies=_login_required)
app.include_router(seoul_bus_router, dependencies=_login_required)

# 이미 만들어진 표에 뒤늦게 추가된 컬럼을 채워 넣는다. (PostgreSQL 전용, 이미 있으면 건너뜀)
_EXTRA_COLUMNS = [
    # 사진 장소
    "ALTER TABLE group_photos ADD COLUMN IF NOT EXISTS place_id VARCHAR(40)",
    "ALTER TABLE group_photos ADD COLUMN IF NOT EXISTS place_name VARCHAR(100)",
    "ALTER TABLE group_photos ADD COLUMN IF NOT EXISTS place_address VARCHAR(200)",
    "ALTER TABLE group_photos ADD COLUMN IF NOT EXISTS place_lat DOUBLE PRECISION",
    "ALTER TABLE group_photos ADD COLUMN IF NOT EXISTS place_lng DOUBLE PRECISION",
    # 약속: 어느 그룹의 약속인지, 누가 만들었는지 (표가 없는 환경에서는 건너뜀)
    "ALTER TABLE IF EXISTS meetings ADD COLUMN IF NOT EXISTS group_id BIGINT REFERENCES groups(id) ON DELETE CASCADE",
    "ALTER TABLE IF EXISTS meetings ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL",
    # 위치 공유 표: Supabase 의 anon 키로는 접근 못 하게 RLS 를 켠다 (서버는 postgres 역할이라 영향 없음)
    "ALTER TABLE IF EXISTS location_shares ENABLE ROW LEVEL SECURITY",
]


def _prepare_tables() -> None:
    """없는 테이블을 만들고, 뒤늦게 추가된 컬럼이 없으면 추가한다. 이미 있는 데이터는 건드리지 않는다.
    DB 연결이 느려도 서버 시작을 막지 않도록 따로 실행하고, 실패하면 로그만 남긴다."""
    try:
        Base.metadata.create_all(engine)
        if engine.dialect.name == "postgresql":
            with engine.begin() as conn:
                for sql in _EXTRA_COLUMNS:
                    conn.execute(text(sql))
        logger.warning("DB 테이블 확인 완료 (사진 장소 + 약속 group_id + 위치 공유)")
    except Exception as e:  # noqa: BLE001
        logger.error("DB 테이블 생성/확인 실패: %s", e)


def _cleanup_locations() -> None:
    """만료됐거나 중단된 위치 공유 행을 1분마다 삭제한다. (정리 작업)"""
    if engine.dialect.name != "postgresql":
        return
    waiter = threading.Event()
    while not waiter.wait(60):
        try:
            with engine.begin() as conn:
                conn.execute(
                    text("DELETE FROM location_shares WHERE expires_at <= NOW() OR stopped_at IS NOT NULL")
                )
        except Exception as e:  # noqa: BLE001
            logger.error("위치 정리 작업 실패: %s", e)


threading.Thread(target=_prepare_tables, daemon=True).start()
threading.Thread(target=_cleanup_locations, daemon=True).start()

if ALLOW_DEV_AUTH:
    logger.warning("⚠ ALLOW_DEV_AUTH=true : X-User-Id 임시 인증이 켜져 있습니다. 개발 환경에서만 사용하세요.")
    from app.routers import dev
    app.include_router(dev.router)


@app.get("/health")
def health():
    return {"status": "ok"}