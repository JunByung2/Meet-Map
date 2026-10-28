from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import DATABASE_URL

# Supabase 서버 측 pooler가 연결을 관리하도록 앱에서는 유휴 연결을 보관하지 않는다.
# SQLite 검증 환경은 기존 연결 방식을 유지한다.
_url = make_url(DATABASE_URL)
_options = {"pool_pre_ping": True}
if _url.get_backend_name() == "postgresql":
    _options["poolclass"] = NullPool
    if _url.get_driver_name() == "psycopg":
        # Supabase Transaction pooler와 호환되도록 자동 prepared statement를 끈다.
        _options["connect_args"] = {"prepare_threshold": None}

engine = create_engine(DATABASE_URL, **_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    """요청마다 세션을 열고, 정상 종료·오류 모두 연결을 반환한다."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
