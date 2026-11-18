"""웹 공격 방어용 공통 장치: 보안 헤더, 요청 출처 검사(CSRF), 클라이언트 주소 추출."""
import re
from urllib.parse import urlparse

from fastapi import Request
from fastapi.responses import JSONResponse

from app.config import ALLOWED_ORIGINS, FRONTEND_URL, SESSION_COOKIE_NAME
from app.ratelimit import limiter
from app.security import hash_token

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _origin_of(url: str) -> str:
    p = urlparse(url.strip())
    if not p.scheme or not p.netloc:
        return ""
    return f"{p.scheme}://{p.netloc}".lower()


def allowed_origins() -> set[str]:
    """브라우저가 보낸 Origin 으로 인정할 주소들. 프론트 주소 + 환경변수로 추가한 주소."""
    origins = {_origin_of(FRONTEND_URL)}
    origins.update(_origin_of(o) for o in ALLOWED_ORIGINS)
    host = urlparse(FRONTEND_URL).hostname
    if host in ("localhost", "127.0.0.1"):  # 개발 환경에서는 두 표기를 모두 인정한다
        port = urlparse(FRONTEND_URL).port
        suffix = f":{port}" if port else ""
        origins.update({f"http://localhost{suffix}", f"http://127.0.0.1{suffix}"})
    origins.discard("")
    return origins


def client_ip(request: Request) -> str:
    """요청한 사람의 주소. 프론트 서버(프록시)가 붙인 X-Forwarded-For 의 마지막 값을 쓴다.

    첫 번째 값은 요청자가 마음대로 적을 수 있어서 믿지 않는다.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        last = forwarded.split(",")[-1].strip()
        if last:
            return last[:64]
    return request.client.host if request.client else "unknown"


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), payment=()",
}


# 비용이 큰 기능(외부 API 호출, 파일 업로드, 도배 가능한 쓰기)은 로그인한 사용자도 횟수를 제한한다.
# (메서드, 경로 패턴, 허용 횟수, 시간(초), 이름)
THROTTLE_RULES = [
    ("POST", re.compile(r"^/(recommend|transit/routes)$"), 30, 60, "route-tools"),
    ("POST", re.compile(r"^/groups/\d+/place-plans/[^/]+/recommend$"), 12, 300, "place-recommend"),
    ("GET", re.compile(r"^/groups/\d+/place-plans/[^/]+/places$"), 60, 60, "place-nearby"),
    ("GET", re.compile(r"^/(tago-bus|transit|seoul-bus)/"), 120, 60, "transit-lookup"),
    ("POST", re.compile(r"^/groups/\d+/messages$"), 60, 60, "chat-send"),
    ("POST", re.compile(r"^/groups/\d+/chat-files$"), 120, 600, "chat-upload"),
    ("POST", re.compile(r"^/groups/\d+/(photos|records)(/\d+/photos)?$"), 40, 600, "photo-upload"),
]


# 파일 업로드가 아닌 요청은 본문이 1MB를 넘으면 받지 않는다 (서버 메모리를 채우는 공격 방지)
MAX_JSON_BYTES = 1 * 1024 * 1024
UPLOAD_PATH = re.compile(r"^/(groups/\d+/(photos|records|chat-files)(/.*)?|auth/me/avatar)$")


def _throttle_key(request: Request) -> str:
    """로그인한 사용자는 세션 단위로, 아니면 접속 주소 단위로 센다."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    return "s:" + hash_token(token)[:16] if token else "ip:" + client_ip(request)


def install(app) -> None:
    @app.middleware("http")
    async def _origin_check(request: Request, call_next):
        """로그인된 브라우저가 다른 사이트에서 몰래 보내는 쓰기 요청(CSRF)을 막는다.

        쓰기 요청에 Origin 이 있는데 우리 사이트가 아니면 거절한다.
        Origin 이 없는 요청(서버끼리 호출, 일부 도구)은 쿠키가 있어도 SameSite 설정에 맡긴다.
        """
        if request.method in UNSAFE_METHODS:
            origin = request.headers.get("origin")
            if origin is not None and origin.strip().lower() not in allowed_origins():
                return JSONResponse({"detail": "허용되지 않은 요청 출처입니다."}, status_code=403)
        return await call_next(request)

    @app.middleware("http")
    async def _body_limit(request: Request, call_next):
        length = request.headers.get("content-length", "")
        if length.isdigit() and int(length) > MAX_JSON_BYTES and not UPLOAD_PATH.match(request.url.path):
            return JSONResponse({"detail": "요청 내용이 너무 커요."}, status_code=413)
        return await call_next(request)

    @app.middleware("http")
    async def _throttle(request: Request, call_next):
        path = request.url.path
        for method, pattern, limit, window, name in THROTTLE_RULES:
            if request.method == method and pattern.match(path):
                key = f"{name}:{_throttle_key(request)}"
                wait = limiter.blocked(key, limit, window)
                if wait:
                    return JSONResponse(
                        {"detail": "요청이 너무 많아요. 잠시 후 다시 시도해 주세요."},
                        status_code=429, headers={"Retry-After": str(wait)},
                    )
                limiter.hit(key, window)
                break
        return await call_next(request)

    @app.middleware("http")
    async def _security_headers(request: Request, call_next):
        response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        # 로그인·내 정보 응답은 브라우저나 중간 서버에 저장되지 않게 한다
        if request.url.path.startswith("/auth"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response