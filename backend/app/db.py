import os

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import DATABASE_URL

# 연결을 매번 새로 만들면 요청마다 원격 DB(Supabase)와 접속·인증을 다시 해서 느려진다.
# 그래서 연결을 몇 개 만들어 두고 재사용한다. (Supabase pooler 앞에서도 이 방식이 안전하다)
# 개수는 환경변수 DB_POOL_SIZE / DB_MAX_OVERFLOW 로 바꿀 수 있다.
# SQLite 검증 환경은 기존 연결 방식을 유지한다.
_url = make_url(DATABASE_URL)
_options = {"pool_pre_ping": True}
if _url.get_backend_name() == "postgresql":
    _options.update(
        pool_size=int(os.getenv("DB_POOL_SIZE", "5")),
        max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "5")),
        pool_recycle=240,  # pooler가 오래 놀던 연결을 끊기 전에 새로 만든다
        pool_timeout=10,
    )
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