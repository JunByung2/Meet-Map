"""개발용 확인 API. 임시 인증과 같이 ALLOW_DEV_AUTH=true 일 때만 main.py 에서 등록된다."""
from fastapi import APIRouter, Depends

from app.deps.auth import get_current_user, require_group_member, require_group_owner
from app.models import GroupMember, User

router = APIRouter(prefix="/dev", tags=["dev"])


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "nickname": user.nickname}


@router.get("/groups/{group_id}/ping")
def ping_member(group_id: int, member: GroupMember = Depends(require_group_member)):
    return {"group_id": member.group_id, "user_id": member.user_id, "role": member.role}


@router.get("/groups/{group_id}/owner-only")
def ping_owner(group_id: int, member: GroupMember = Depends(require_group_owner)):
    return {"ok": True}