import os
from pathlib import Path

from dotenv import load_dotenv

# backend/.env 를 먼저 읽어서 환경변수로 등록한다 (창에서 set 한 값이 있으면 그 값이 우선)
# 반드시 아래의 os.getenv(...) 들보다 위에 있어야 한다.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# 예: postgresql+psycopg://postgres:비밀번호@localhost:5432/meetmap
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://postgres:postgres@localhost:5432/meetmap",
)

# 개발용 임시 인증(X-User-Id 헤더) 스위치. 기본값은 꺼짐.
# 개발 환경에서만 ALLOW_DEV_AUTH=true 로 켜고, 배포 환경에서는 절대 켜지 않는다.
ALLOW_DEV_AUTH = os.getenv("ALLOW_DEV_AUTH", "false").lower() == "true"

# 세션 쿠키 설정
SESSION_COOKIE_NAME = "session_id"
SESSION_TTL_DAYS = int(os.getenv("SESSION_TTL_DAYS", "7"))
# https 로 배포할 때는 반드시 true. 로컬(http://localhost)에서는 false 여야 쿠키가 저장된다.
# 로그인이 끝나면 사용자를 돌려보낼 프론트 주소
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

# 값을 따로 주지 않으면, 프론트 주소가 https 일 때 자동으로 true (https 배포에서 실수로 꺼 두는 일을 막는다)
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true" if FRONTEND_URL.lower().startswith("https://") else "false").lower() == "true"

# 쓰기 요청(POST 등)을 허용할 추가 사이트 주소 (쉼표로 구분). 프론트 주소는 자동으로 허용된다.
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]

# API 문서(/docs, /redoc, /openapi.json)는 개발할 때만 연다. 배포 환경에서는 API 구조를 숨긴다.
ENABLE_DOCS = os.getenv("ENABLE_DOCS", "false").lower() == "true"

# --- 카카오 OAuth (값은 .env 에만 넣는다) ---
KAKAO_CLIENT_ID = os.getenv("KAKAO_CLIENT_ID", "")
KAKAO_CLIENT_SECRET = os.getenv("KAKAO_CLIENT_SECRET", "")
KAKAO_REDIRECT_URI = os.getenv("KAKAO_REDIRECT_URI", "http://localhost:3000/api/auth/kakao/callback")

# --- 구글 OAuth (값은 .env 에만 넣는다) ---
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:3000/api/auth/google/callback")

# --- 사진 (Supabase Storage) : 값은 .env 에만 넣는다 ---
# 사진 파일은 Supabase 의 비공개 버킷에 저장하고, 브라우저는 Supabase 에 직접 접속하지 않는다.
# 서버(FastAPI)가 service_role 키로만 Storage 에 접근하므로 이 키는 절대 프론트/깃에 넣지 않는다.
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")  # 예: https://abcd1234.supabase.co
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
PHOTO_BUCKET = os.getenv("PHOTO_BUCKET", "memory-photos")
PHOTO_MAX_FILES = 20                    # 한 번에 올릴 수 있는 장수
PHOTO_MAX_BYTES = 20 * 1024 * 1024      # 사진 한 장 최대 용량 (20MB)
PHOTO_SIGNED_URL_SECONDS = 30 * 60      # 사진 볼 때 쓰는 임시 주소 유효시간 (30분)