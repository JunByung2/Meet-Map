"""
소셜 로그인 (카카오 / 구글) + 계정 연동

흐름:
  1) GET /auth/{provider}/login     : state 를 만들어 쿠키에 저장하고 소셜 로그인 화면으로 보냄
  2) GET /auth/{provider}/callback  : state 검증 -> code 를 토큰으로 교환 -> 사용자 정보 조회
                                      -> 회원 찾기/만들기 -> 세션 쿠키 발급 -> 프론트로 이동

연동 (이미 로그인한 회원이 소셜 계정을 자기 계정에 붙이는 흐름):
  GET /auth/{provider}/link         : 로그인한 회원만 시작 가능. 콜백에서 새 회원을 만들지 않고
                                      지금 로그인한 회원에 oauth_accounts 행을 추가한다.
                                      끝나면 /settings?link=결과 로 돌아간다.

연결 관리:
  GET    /auth/me/identities          : 내 계정에 연결된 로그인 수단 목록
  DELETE /auth/me/identities/{provider}: 소셜 연동 해제 (마지막 로그인 수단은 해제 불가)

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
from sqlalchemy import delete, select
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
from app.deps.auth import get_current_user
from app.models import OAuthAccount, Session, User
from app.security import hash_token, new_session_token

logger = logging.getLogger("meetmap")
router = APIRouter(prefix="/auth", tags=["oauth"])

STATE_COOKIE = "oauth_state"  # CSRF 방지용 state 를 잠깐 담아두는 쿠키
LINK_COOKIE = "oauth_link"    # '로그인'이 아니라 '내 계정에 연동'하는 흐름이라는 표시


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
        "scope": "profile_nickname profile_image",
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
    resp.delete_cookie(LINK_COOKIE, path="/")
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


# 소셜에서 닉네임을 못 받았을 때 임시로 들어가는 기본값
DEFAULT_NICKNAMES = {"카카오사용자", "구글사용자"}


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
        user = db.get(User, account.user_id)
        # 예전에 기본값으로 저장된 닉네임이면, 이번에 받은 진짜 닉네임으로 바꾼다.
        # (사용자가 설정에서 직접 바꾼 닉네임은 기본값이 아니므로 건드리지 않는다)
        if (
            user is not None
            and user.status == "active"
            and user.nickname in DEFAULT_NICKNAMES
            and nickname not in DEFAULT_NICKNAMES
        ):
            user.nickname = nickname[:30]
            db.commit()
        return user

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


def _current_user_or_none(request: Request, db: DbSession) -> User | None:
    """쿠키의 세션으로 지금 로그인한 회원을 찾는다. 없으면 None."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return None
    row = db.get(Session, hash_token(token))
    if row is None or row.expires_at <= datetime.now(timezone.utc):
        return None
    user = db.get(User, row.user_id)
    return user if user is not None and user.status == "active" else None


def _link_result(result: str) -> RedirectResponse:
    """연동이 끝나면 설정 페이지로 돌려보낸다. (result: ok / already / taken / dup / login / error)"""
    resp = RedirectResponse(f"{FRONTEND_URL}/settings?link={result}", status_code=302)
    resp.delete_cookie(STATE_COOKIE, path="/")
    resp.delete_cookie(LINK_COOKIE, path="/")
    return resp


def link_account(db: DbSession, me: User, provider: str, provider_user_id: str) -> str:
    """이 소셜 계정을 '지금 로그인한 나'에게 붙인다. 결과 문자열을 돌려준다."""
    existing = db.scalar(
        select(OAuthAccount).where(
            OAuthAccount.provider == provider,
            OAuthAccount.provider_user_id == provider_user_id,
        )
    )
    if existing is not None:
        return "already" if existing.user_id == me.id else "taken"  # taken: 다른 회원에 이미 연결됨

    same_provider = db.scalar(
        select(OAuthAccount).where(
            OAuthAccount.user_id == me.id, OAuthAccount.provider == provider
        )
    )
    if same_provider is not None:
        return "dup"  # 이미 같은 종류(카카오 등)가 하나 연결돼 있음

    db.add(OAuthAccount(user_id=me.id, provider=provider, provider_user_id=provider_user_id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return "taken"
    return "ok"


# ---------- API ----------

def _start_oauth(provider: str, link: bool) -> RedirectResponse:
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
    if link:
        resp.set_cookie(
            LINK_COOKIE, "1",
            max_age=600, httponly=True, secure=COOKIE_SECURE, samesite="lax", path="/",
        )
    else:
        resp.delete_cookie(LINK_COOKIE, path="/")
    return resp


@router.get("/{provider}/login")
def oauth_login(provider: str):
    return _start_oauth(provider, link=False)


@router.get("/{provider}/link")
def oauth_link(provider: str, user: User = Depends(get_current_user)):
    # 로그인한 사람만 연동을 시작할 수 있다 (로그인 안 했으면 401)
    return _start_oauth(provider, link=True)


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
    link_mode = request.cookies.get(LINK_COOKIE) == "1"

    # 1) 사용자가 취소했거나, state 가 우리가 보낸 값과 다르면 거부
    saved_state = request.cookies.get(STATE_COOKIE)
    if error or not code or not state or not saved_state or not hmac.compare_digest(state, saved_state):
        return _link_result("error") if link_mode else fail_redirect()

    # 2) code -> 토큰 -> 사용자 정보
    try:
        access_token = exchange_code(cfg, code)
        info = fetch_userinfo(cfg, access_token)
    except (httpx.HTTPError, KeyError, ValueError):
        logger.warning("%s 로그인: 토큰 교환 또는 사용자 정보 조회 실패", provider)
        return _link_result("error") if link_mode else fail_redirect()

    provider_user_id, nickname, image = cfg["parse"](info)
    if not provider_user_id:
        return _link_result("error") if link_mode else fail_redirect()

    # 2-1) 연동 모드: 새 회원을 만들지 않고, 지금 로그인한 내 계정에 붙인다
    if link_mode:
        me = _current_user_or_none(request, db)
        if me is None:
            return _link_result("login")
        return _link_result(link_account(db, me, provider, provider_user_id))

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
    resp.delete_cookie(LINK_COOKIE, path="/")
    return resp


# ---------- 연결된 로그인 수단 보기 / 해제 ----------

@router.get("/me/identities")
def my_identities(
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    """내 계정에 연결된 소셜 로그인 목록과 비밀번호 로그인 사용 여부"""
    providers = db.scalars(
        select(OAuthAccount.provider).where(OAuthAccount.user_id == user.id)
    ).all()
    return {"providers": sorted(set(providers)), "has_password": user.password is not None}


@router.delete("/me/identities/{provider}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_identity(
    provider: str,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    """소셜 연동을 해제한다. 해제하면 로그인할 방법이 하나도 안 남는 경우는 막는다."""
    if provider not in PROVIDERS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")

    mine = db.scalars(
        select(OAuthAccount).where(OAuthAccount.user_id == user.id)
    ).all()
    target = [a for a in mine if a.provider == provider]
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "연결돼 있지 않아요.")

    remaining = len(mine) - len(target) + (1 if user.password is not None else 0)
    if remaining < 1:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "마지막 로그인 방법은 해제할 수 없어요. 다른 로그인 방법을 먼저 연결해 주세요.",
        )

    db.execute(
        delete(OAuthAccount).where(
            OAuthAccount.user_id == user.id, OAuthAccount.provider == provider
        )
    )
    db.commit()