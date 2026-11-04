"""
소셜 로그인 (카카오 / 구글)

흐름:
  1) GET /auth/{provider}/login     : state 를 만들어 쿠키에 저장하고 소셜 로그인 화면으로 보냄
  2) GET /auth/{provider}/callback  : state 검증 -> code 를 토큰으로 교환 -> 사용자 정보 조회
                                      -> 회원 찾기/만들기 -> 세션 쿠키 발급 -> 프론트로 이동

로그인 이후(세션 쿠키, 접근통제)는 자체 로그인과 똑같이 동작한다.
"""
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.config import (
    COOKIE_SECURE,
    FRONTEND_URL,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    KAKAO_CLIENT_ID,
    KAKAO_CLIENT_SECRET,
    KAKAO_REDIRECT_URI,
    SESSION_COOKIE_NAME,
    SESSION_TTL_DAYS,
)
from app.db import get_db
from app.models import OAuthAccount, Session, User
from app.security import hash_token, new_session_token

logger = logging.getLogger("meetmap")
router = APIRouter(prefix="/auth", tags=["oauth"])

STATE_COOKIE = "oauth_state"  # CSRF 방지용 state 를 잠깐 담아두는 쿠키


# ---------- 제공자별 설정 ----------

def parse_kakao(data: dict) -> tuple[str | None, str, str | None]:
    """카카오 사용자 정보 -> (회원번호, 닉네임, 프로필 이미지)"""
    uid = data.get("id")
    account = data.get("kakao_account") or {}
    profile = account.get("profile") or {}
    props = data.get("properties") or {}
    nickname = profile.get("nickname") or props.get("nickname") or "카카오사용자"
    image = profile.get("profile_image_url") or props.get("profile_image")
    return (str(uid) if uid is not None else None, nickname, image)


def parse_google(data: dict) -> tuple[str | None, str, str | None]:
    """구글 사용자 정보 -> (회원번호(sub), 이름, 프로필 이미지)"""
    sub = data.get("sub")
    nickname = data.get("name") or data.get("given_name") or "구글사용자"
    image = data.get("picture")
    return (str(sub) if sub else None, nickname, image)


PROVIDERS = {
    "kakao": {
        "authorize_url": "https://kauth.kakao.com/oauth/authorize",
        "token_url": "https://kauth.kakao.com/oauth/token",
        "userinfo_url": "https://kapi.kakao.com/v2/user/me",
        "client_id": KAKAO_CLIENT_ID,
        "client_secret": KAKAO_CLIENT_SECRET,
        "redirect_uri": KAKAO_REDIRECT_URI,
        "scope": None,
        "extra_params": {},
        "parse": parse_kakao,
    },
    "google": {
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://openidconnect.googleapis.com/v1/userinfo",
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "scope": "openid profile",  # 이메일은 받지 않는다 (필요한 정보만 요청)
        "extra_params": {"prompt": "select_account"},  # 로그인할 때마다 계정을 고르게 함
        "parse": parse_google,
    },
}


def get_provider(provider: str) -> dict:
    cfg = PROVIDERS.get(provider)
    if cfg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")
    if not cfg["client_id"]:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "로그인 설정이 되어 있지 않습니다.")
    return cfg


# ---------- 내부 도구 ----------

def fail_redirect(reason: str = "login_failed") -> RedirectResponse:
    """실패하면 이유를 자세히 알려주지 않고 로그인 화면으로 돌려보낸다."""
    resp = RedirectResponse(f"{FRONTEND_URL}/login?error={reason}", status_code=302)
    resp.delete_cookie(STATE_COOKIE, path="/")
    return resp


def exchange_code(cfg: dict, code: str) -> str:
    """code 를 access_token 으로 바꾼다."""
    form = {
        "grant_type": "authorization_code",
        "client_id": cfg["client_id"],
        "redirect_uri": cfg["redirect_uri"],
        "code": code,
    }
    if cfg["client_secret"]:
        form["client_secret"] = cfg["client_secret"]
    r = httpx.post(cfg["token_url"], data=form, timeout=10)
    r.raise_for_status()
    return r.json()["access_token"]


def fetch_userinfo(cfg: dict, access_token: str) -> dict:
    r = httpx.get(
        cfg["userinfo_url"],
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def find_or_create_user(
    db: DbSession, provider: str, provider_user_id: str, nickname: str, image: str | None
) -> User | None:
    """소셜 계정이 이미 있으면 그 회원, 없으면 새 회원을 만든다.
    (이메일이 같다고 기존 계정에 자동으로 합치지 않는다 - 계정 탈취 방지)"""
    find = select(OAuthAccount).where(
        OAuthAccount.provider == provider,
        OAuthAccount.provider_user_id == provider_user_id,
    )
    account = db.scalar(find)
    if account:
        return db.get(User, account.user_id)

    user = User(nickname=nickname[:30], profile_image=image[:500] if image else None)
    db.add(user)
    db.flush()  # user.id 를 얻는다
    db.add(OAuthAccount(user_id=user.id, provider=provider, provider_user_id=provider_user_id))
    try:
        db.commit()
    except IntegrityError:
        # 같은 사람이 동시에 처음 로그인해서 이미 만들어진 경우
        db.rollback()
        account = db.scalar(find)
        return db.get(User, account.user_id) if account else None
    db.refresh(user)
    return user


# ---------- API ----------

@router.get("/{provider}/login")
def oauth_login(provider: str):
    cfg = get_provider(provider)
    state = secrets.token_urlsafe(32)

    params = {
        "client_id": cfg["client_id"],
        "redirect_uri": cfg["redirect_uri"],
        "response_type": "code",
        "state": state,
        **cfg["extra_params"],
    }
    if cfg["scope"]:
        params["scope"] = cfg["scope"]

    resp = RedirectResponse(f"{cfg['authorize_url']}?{urlencode(params)}", status_code=302)
    resp.set_cookie(
        STATE_COOKIE, state,
        max_age=600, httponly=True, secure=COOKIE_SECURE, samesite="lax", path="/",
    )
    return resp


@router.get("/{provider}/callback")
def oauth_callback(
    provider: str,
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: DbSession = Depends(get_db),
):
    cfg = get_provider(provider)

    # 1) 사용자가 취소했거나, state 가 우리가 보낸 값과 다르면 거부
    saved_state = request.cookies.get(STATE_COOKIE)
    if error or not code or not state or not saved_state or not hmac.compare_digest(state, saved_state):
        return fail_redirect()

    # 2) code -> 토큰 -> 사용자 정보
    try:
        access_token = exchange_code(cfg, code)
        info = fetch_userinfo(cfg, access_token)
    except (httpx.HTTPError, KeyError, ValueError):
        logger.warning("%s 로그인: 토큰 교환 또는 사용자 정보 조회 실패", provider)
        return fail_redirect()

    provider_user_id, nickname, image = cfg["parse"](info)
    if not provider_user_id:
        return fail_redirect()

    # 3) 회원 찾기/만들기
    user = find_or_create_user(db, provider, provider_user_id, nickname, image)
    if user is None or user.status != "active":
        return fail_redirect()

    # 4) 세션 발급 (로그인할 때마다 새 토큰)
    token = new_session_token()
    db.add(Session(
        id=hash_token(token),
        user_id=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS),
    ))
    db.commit()

    resp = RedirectResponse(f"{FRONTEND_URL}/groups", status_code=302)
    resp.set_cookie(
        SESSION_COOKIE_NAME, token,
        max_age=SESSION_TTL_DAYS * 86400,
        httponly=True, secure=COOKIE_SECURE, samesite="lax", path="/",
    )
    resp.delete_cookie(STATE_COOKIE, path="/")
    return resp