"""기존 세션 인증과 그룹 접근통제를 재사용하는 추천 API."""
import hashlib
import json
from datetime import datetime, timezone
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.db import get_db
from app.deps.auth import get_current_user, require_group_member
from app.models import Group, GroupMember, User
from app.routers.messages import Message
from meeting_tools.planning.models import Departure, PlacePlan
from meeting_tools.recommendation.recommend_service import recommend_places
from meeting_tools.transit.kakao_route import TransitError

router = APIRouter(prefix="/groups/{group_id}/place-plans", tags=["place-plans"],
                   dependencies=[Depends(require_group_member)])

class CreatePlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID  # 재시도해도 링크와 메시지가 중복되지 않게 하는 ID

class DepartureIn(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    place_id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    address: str = Field(default="", max_length=500)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)

    @field_validator("place_id", "name")
    @classmethod
    def nonblank(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("장소 이름과 ID가 필요합니다.")
        return value

def get_plan(db, group_id, plan_id, *, lock=False):
    query = select(PlacePlan).where(PlacePlan.id == str(plan_id), PlacePlan.group_id == group_id)
    if lock:
        query = query.with_for_update()
    plan = db.scalar(query.execution_options(populate_existing=True))
    if plan is None:
        raise HTTPException(404, "이 그룹의 추천 링크를 찾을 수 없습니다.")
    return plan

def members_and_departures(db, plan):
    members = db.execute(select(GroupMember.user_id, User.nickname, GroupMember.joined_at)
        .join(User, User.id == GroupMember.user_id)
        .where(GroupMember.group_id == plan.group_id).order_by(GroupMember.user_id)).all()
    stored = {d.user_id: d for d in db.scalars(select(Departure)
        .where(Departure.plan_id == plan.id).execution_options(populate_existing=True))}
    # 탈퇴 후 재가입한 멤버는 과거 출발지를 자동 재사용하지 않는다.
    departures = {m.user_id: stored[m.user_id] for m in members if m.user_id in stored
        and stored[m.user_id].updated_at.replace(tzinfo=timezone.utc)
        >= m.joined_at.replace(tzinfo=timezone.utc)}
    # 변경 후 같은 좌표로 돌아와도 예전 계산이 저장되지 않도록 revision 포함.
    snapshot = hashlib.sha256(json.dumps([plan.revision,
        [[m.user_id, str(m.joined_at), [departures[m.user_id].latitude, departures[m.user_id].longitude]
          if m.user_id in departures else None] for m in members]], sort_keys=True).encode()).hexdigest()
    return members, departures, snapshot

def serialize_departure(departure):
    if departure is None:
        return None
    return {
        "place_id": departure.place_id,
        "name": departure.name,
        "address": departure.address,
        "latitude": departure.latitude,
        "longitude": departure.longitude,
    }


def state(db, plan, user):
    members, departures, snapshot = members_and_departures(db, plan)
    complete = 2 <= len(members) <= 5 and all(m.user_id in departures for m in members)
    # 이 API는 require_group_member를 통과한 같은 그룹 멤버에게만 제공한다.
    # 순서는 user_id 기준으로 고정하여 모든 접속자의 번호/색상이 같도록 한다.
    return {
        "id": plan.id, "group_id": plan.group_id,
        "group_name": db.get(Group, plan.group_id).name,
        "me": {"id": user.id, "nickname": user.nickname},
        "created_at": plan.created_at, "snapshot": snapshot,
        "members": [{
            "user_id": member.user_id,
            "nickname": member.nickname,
            "ready": member.user_id in departures,
            "departure": serialize_departure(departures.get(member.user_id)),
        } for member in members],
        "own_departure": serialize_departure(departures.get(user.id)),
        "can_recommend": complete,
        "result": plan.result if complete and plan.result_snapshot == snapshot else None,
    }

@router.post("", status_code=201)
def create_plan(group_id: int, body: CreatePlan, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    plan_id = str(body.request_id)
    existing = db.get(PlacePlan, plan_id)
    if existing:
        if existing.group_id != group_id or existing.created_by != user.id:
            raise HTTPException(409, "새 요청으로 다시 시도해 주세요.")
        return {"id": existing.id, "href": f"/recommend?groupId={group_id}&planId={existing.id}"}
    href = f"/recommend?groupId={group_id}&planId={plan_id}"
    db.add(PlacePlan(id=plan_id, group_id=group_id, created_by=user.id, revision=0))
    # 추천 계획과 공유 채팅 메시지를 함께 저장한다.
    db.add(Message(group_id=group_id, user_id=user.id,
        text=f"약속 장소를 함께 정해요. 각자 출발지를 입력해 주세요.\n{href}"))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.get(PlacePlan, plan_id)
        if not existing or existing.group_id != group_id or existing.created_by != user.id:
            raise HTTPException(409, "링크를 만들지 못했습니다. 다시 시도해 주세요.") from None
    return {"id": plan_id, "href": href}

@router.get("/{plan_id}")
def read_plan(group_id: int, plan_id: UUID, user: User = Depends(get_current_user),
              db: Session = Depends(get_db)):
    return state(db, get_plan(db, group_id, plan_id), user)

@router.put("/{plan_id}/my-departure")
def save_departure(group_id: int, plan_id: UUID, body: DepartureIn,
                   user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    plan = get_plan(db, group_id, plan_id, lock=True)
    own = db.get(Departure, (plan.id, user.id))
    if own is None:
        own = Departure(plan_id=plan.id, user_id=user.id)
        db.add(own)
    for key, value in body.model_dump().items():
        setattr(own, key, value)
    own.updated_at = datetime.now(timezone.utc)
    plan.revision += 1
    plan.result = None
    plan.result_snapshot = None
    db.commit()
    return state(db, plan, user)

@router.delete("/{plan_id}/my-departure")
def delete_departure(group_id: int, plan_id: UUID, user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    plan = get_plan(db, group_id, plan_id, lock=True)
    own = db.get(Departure, (plan.id, user.id))
    if own:
        db.delete(own)
        plan.revision += 1
        plan.result = None
        plan.result_snapshot = None
    db.commit()
    return state(db, plan, user)

@router.post("/{plan_id}/recommend")
def recommend(group_id: int, plan_id: UUID, user: User = Depends(get_current_user),
              db: Session = Depends(get_db)):
    plan = get_plan(db, group_id, plan_id)
    members, departures, snapshot = members_and_departures(db, plan)
    if not (2 <= len(members) <= 5) or any(m.user_id not in departures for m in members):
        raise HTTPException(409, "그룹 멤버 2~5명 전원의 출발지를 먼저 입력해 주세요.")
    if plan.result and plan.result_snapshot == snapshot:
        generated_at = plan.result.get("generated_at")
        if generated_at:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(generated_at)).total_seconds()
            if 0 <= age < 300:
                return state(db, plan, user)
    locations = [{"x": departures[m.user_id].longitude, "y": departures[m.user_id].latitude}
                 for m in members]
    member_ids = [m.user_id for m in members]
    db.rollback()  # 외부 API 대기 중 DB 연결을 잡아두지 않는다.
    try:
        result = recommend_places(locations)
    except TransitError as error:
        print("[추천 조회 실패]", str(error), flush=True)
        raise HTTPException(
        502,
        "이동시간을 조회하지 못했어요. 잠시 후 다시 시도해 주세요.",
    ) from None
    if not db.get(GroupMember, (group_id, user.id)):
        raise HTTPException(403, "접근 권한이 없습니다.")
    plan = get_plan(db, group_id, plan_id, lock=True)
    if members_and_departures(db, plan)[2] != snapshot:
        raise HTTPException(409, "출발지나 멤버가 바뀌었어요. 최신 입력으로 다시 추천받아 주세요.")
    plan.result = {**result, "member_ids": member_ids,
                   "generated_at": datetime.now(timezone.utc).isoformat()}
    plan.result_snapshot = snapshot
    db.commit()
    return state(db, plan, user)
