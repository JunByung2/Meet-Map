import logging

from fastapi import FastAPI

from app.config import ALLOW_DEV_AUTH
from app.routers import auth, group_members, groups, invites, oauth

logger = logging.getLogger("meetmap")

app = FastAPI(title="MeetMap API")

app.include_router(auth.router)
app.include_router(oauth.router)
app.include_router(groups.router)
app.include_router(group_members.router)
app.include_router(invites.router)
app.include_router(invites.join_router)

if ALLOW_DEV_AUTH:
    logger.warning("⚠ ALLOW_DEV_AUTH=true : X-User-Id 임시 인증이 켜져 있습니다. 개발 환경에서만 사용하세요.")
    from app.routers import dev
    app.include_router(dev.router)


@app.get("/health")
def health():
    return {"status": "ok"}