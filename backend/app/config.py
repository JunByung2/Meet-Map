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
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"

# 로그인이 끝나면 사용자를 돌려보낼 프론트 주소
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

# --- 카카오 OAuth (값은 .env 에만 넣는다) ---
KAKAO_CLIENT_ID = os.getenv("KAKAO_CLIENT_ID", "")
KAKAO_CLIENT_SECRET = os.getenv("KAKAO_CLIENT_SECRET", "")
KAKAO_REDIRECT_URI = os.getenv("KAKAO_REDIRECT_URI", "http://localhost:3000/api/auth/kakao/callback")

# --- 구글 OAuth (값은 .env 에만 넣는다) ---
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:3000/api/auth/google/callback")