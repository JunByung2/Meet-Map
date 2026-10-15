from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.config import COOKIE_SECURE, SESSION_COOKIE_NAME, SESSION_TTL_DAYS
from app.db import get_db
from app.deps.auth import get_current_user
from app.models import Session as SessionRow, User
from app.schemas import LoginIn, SignupIn, UserOut
from app.security import hash_password, hash_token, new_session_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

LOGIN_FAIL = "이메일 또는 비밀번호가 올바르지 않습니다."  # 이메일/비밀번호 중 뭐가 틀렸는지 알려주지 않는다


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _to_out(user: User) -> UserOut:
    return UserOut(id=user.id, nickname=user.nickname, email=user.email, profile_image=user.profile_image)


@router.post("/signup", status_code=status.HTTP_201_CREATED, response_model=UserOut)
def signup(body: SignupIn, db: DbSession = Depends(get_db)):
    email = _normalize_email(body.email)
    if db.execute(select(User.id).where(User.email == email)).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 가입된 이메일입니다.")

    user = User(
        email=email,
        password=hash_password(body.password),
        nickname=body.nickname.strip(),
        name=body.name,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:  # 동시에 같은 이메일로 가입한 경우
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 가입된 이메일입니다.")
    return _to_out(user)


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, response: Response, db: DbSession = Depends(get_db)):
    email = _normalize_email(body.email)
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()

    # 없는 이메일이어도 verify_password 를 호출해서 응답 시간을 비슷하게 맞춘다.
    password_ok = verify_password(user.password if user else None, body.password)
    if user is None or not password_ok or user.status != "active":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, LOGIN_FAIL)

    # 로그인할 때마다 새 세션 토큰 발급 (세션 고정 공격 방지)
    token = new_session_token()
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)
    db.add(SessionRow(id=hash_token(token), user_id=user.id, expires_at=expires_at))
    db.commit()

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_TTL_DAYS * 24 * 3600,
        httponly=True,        # 자바스크립트로 쿠키를 못 읽게 (XSS 로 탈취 방지)
        secure=COOKIE_SECURE, # https 에서만 전송 (배포 시 true)
        samesite="lax",       # 다른 사이트에서 보내는 POST 요청에는 쿠키 안 붙음 (CSRF 완화)
        path="/",
    )
    return _to_out(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: DbSession = Depends(get_db)):
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token:
        row = db.get(SessionRow, hash_token(token))
        if row is not None:
            db.delete(row)  # 서버에서 세션을 지우므로, 쿠키를 훔쳐 가도 더 못 쓴다
            db.commit()
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return _to_out(user)