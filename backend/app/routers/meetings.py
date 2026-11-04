
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.deps.auth import (
    get_current_user,
    require_group_member,
    require_group_owner,
)
from app.models import (
    Meeting,
    MeetingCandidate,
    MeetingVote,
    User,
)

router = APIRouter(tags=["meetings"])


# --------------------
# 요청 데이터
# --------------------

class MeetingCreate(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    location: str = Field(min_length=1, max_length=200)
    meeting_time: datetime
    status: str = "confirmed"


class CandidateCreate(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    location: str = Field(min_length=1, max_length=200)  # 장소 이름
    meeting_time: datetime
    # 카카오 장소 검색으로 고른 장소 정보 (선택)
    place_id: str | None = Field(default=None, max_length=40)
    place_address: str | None = Field(default=None, max_length=200)
    place_lat: float | None = Field(default=None, ge=-90, le=90)
    place_lng: float | None = Field(default=None, ge=-180, le=180)
    poll_id: str | None = Field(default=None, max_length=40)  # 채팅방에서 한 번에 만든 투표 묶음 번호


# --------------------
# 응답 데이터 변환
# --------------------

# 확정된 약속끼리 겹치지 않게 하는 기준: 약속 하나가 이 시간(분) 동안 이어진다고 보고,
# 이 간격 안에 시작하는 다른 확정 약속이 있으면 "겹친다"고 본다. (약속 길이를 따로 받지 않으므로 고정값)
MEETING_BLOCK_MINUTES = 120


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def find_time_conflict(db: DbSession, group_id: int, when: datetime) -> "Meeting | None":
    """이 시각과 겹치는 확정된 약속이 있으면 그 약속을, 없으면 None"""
    window = timedelta(minutes=MEETING_BLOCK_MINUTES)
    start = _aware(when)
    for m in db.scalars(select(Meeting).where(Meeting.group_id == group_id, Meeting.status == "confirmed")).all():
        if abs(_aware(m.meeting_time) - start) < window:
            return m
    return None


def conflict_message(m: "Meeting") -> str:
    when = _aware(m.meeting_time).astimezone(timezone(timedelta(hours=9)))
    return (
        f"이미 같은 시간대에 확정된 약속이 있어요: '{m.title}' "
        f"({when.month}월 {when.day}일 {when.hour:02d}:{when.minute:02d}). 다른 날짜·시간으로 정해 주세요."
    )


def meeting_to_dict(meeting: Meeting) -> dict:
    return {
        "id": meeting.id,
        "group_id": meeting.group_id,
        "title": meeting.title,
        "location": meeting.location,
        "place_id": meeting.place_id,
        "place_address": meeting.place_address,
        "place_lat": meeting.place_lat,
        "place_lng": meeting.place_lng,
        "meeting_time": meeting.meeting_time.isoformat(),
        "status": meeting.status,
        "created_by": meeting.created_by,
        "created_at": (
            meeting.created_at.isoformat()
            if meeting.created_at else None
        ),
    }


def candidate_to_dict(
    candidate: MeetingCandidate,
    vote_count: int = 0,
) -> dict:
    return {
        "id": candidate.id,
        "group_id": candidate.group_id,
        "title": candidate.title,
        "location": candidate.location,
        "place_id": candidate.place_id,
        "place_address": candidate.place_address,
        "place_lat": candidate.place_lat,
        "place_lng": candidate.place_lng,
        "meeting_time": candidate.meeting_time.isoformat(),
        "poll_id": candidate.poll_id,
        "closed": bool(candidate.closed),
        "chosen": bool(candidate.chosen),
        "created_by": candidate.created_by,
        "vote_count": vote_count,
    }


# --------------------
# 투표 수 계산 공통 함수
# --------------------

def get_candidate_vote_counts(
    db: DbSession,
    group_id: int,
    candidates: list[MeetingCandidate],
) -> dict[int, int]:
    candidate_ids = [candidate.id for candidate in candidates]

    if not candidate_ids:
        return {}

    votes = db.scalars(
        select(MeetingVote).where(
            MeetingVote.candidate_id.in_(candidate_ids)
        )
    ).all()

    counts = {candidate_id: 0 for candidate_id in candidate_ids}

    for vote in votes:
        counts[vote.candidate_id] = (
            counts.get(vote.candidate_id, 0) + 1
        )

    return counts


def poll_candidates(
    db: DbSession,
    group_id: int,
    poll_id: str | None,
) -> list[MeetingCandidate]:
    """같은 투표(poll_id)에 속한 후보들. poll_id 가 없는 예전 후보는 그룹 전체가 한 묶음."""
    stmt = select(MeetingCandidate).where(
        MeetingCandidate.group_id == group_id
    )
    if poll_id is None:
        stmt = stmt.where(MeetingCandidate.poll_id.is_(None))
    else:
        stmt = stmt.where(MeetingCandidate.poll_id == poll_id)
    return list(db.scalars(stmt).all())


# --------------------
# 기존 약속 API
# --------------------

@router.get("/groups/{group_id}/meetings")
def list_meetings(
    group_id: int,
    member=Depends(require_group_member),
    db: DbSession = Depends(get_db),
):
    meetings = db.scalars(
        select(Meeting)
        .where(Meeting.group_id == group_id)
        .order_by(Meeting.meeting_time.asc())
    ).all()

    return [meeting_to_dict(meeting) for meeting in meetings]


@router.post(
    "/groups/{group_id}/meetings",
    status_code=status.HTTP_201_CREATED,
)
def create_meeting(
    group_id: int,
    body: MeetingCreate,
    member=Depends(require_group_member),
    db: DbSession = Depends(get_db),
):
    if not body.title.strip() or not body.location.strip():
        raise HTTPException(
            400,
            "약속 제목과 장소를 입력해 주세요.",
        )

    if body.status == "confirmed":
        clash = find_time_conflict(db, group_id, body.meeting_time)
        if clash is not None:
            raise HTTPException(409, conflict_message(clash))

    meeting = Meeting(
        group_id=group_id,
        title=body.title.strip(),
        location=body.location.strip(),
        meeting_time=body.meeting_time,
        status=body.status,
    )

    db.add(meeting)
    db.commit()
    db.refresh(meeting)

    return meeting_to_dict(meeting)


@router.get("/groups/{group_id}/meetings/{meeting_id}")
def get_meeting(
    group_id: int,
    meeting_id: int,
    member=Depends(require_group_member),
    db: DbSession = Depends(get_db),
):
    meeting = db.scalar(
        select(Meeting).where(
            Meeting.id == meeting_id,
            Meeting.group_id == group_id,
        )
    )

    if meeting is None:
        raise HTTPException(404, "약속을 찾을 수 없습니다.")

    return meeting_to_dict(meeting)


# --------------------
# 후보 등록 및 조회
# --------------------

@router.post(
    "/groups/{group_id}/meeting-candidates",
    status_code=status.HTTP_201_CREATED,
)
def create_candidate(
    group_id: int,
    body: CandidateCreate,
    member=Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    if not body.title.strip() or not body.location.strip():
        raise HTTPException(
            400,
            "후보 제목과 장소를 입력해 주세요.",
        )

    clash = find_time_conflict(db, group_id, body.meeting_time)
    if clash is not None:
        raise HTTPException(409, conflict_message(clash))

    candidate = MeetingCandidate(
        group_id=group_id,
        title=body.title.strip(),
        location=body.location.strip(),
        meeting_time=body.meeting_time,
        place_id=body.place_id,
        place_address=body.place_address,
        place_lat=body.place_lat,
        place_lng=body.place_lng,
        poll_id=body.poll_id,
        created_by=user.id,
    )

    db.add(candidate)
    db.commit()
    db.refresh(candidate)

    return candidate_to_dict(candidate)


@router.get("/groups/{group_id}/meeting-candidates")
def list_candidates(
    group_id: int,
    member=Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    candidates = db.scalars(
        select(MeetingCandidate)
        .where(MeetingCandidate.group_id == group_id)
        .order_by(MeetingCandidate.meeting_time.asc())
    ).all()

    counts = get_candidate_vote_counts(
        db,
        group_id,
        candidates,
    )

    my_votes = set(
        db.scalars(
            select(MeetingVote.candidate_id).where(
                MeetingVote.user_id == user.id,
                MeetingVote.candidate_id.in_([c.id for c in candidates]),
            )
        ).all()
    ) if candidates else set()

    # 항목별로 누가 투표했는지 (그룹 멤버끼리만 볼 수 있는 목록이라 닉네임을 같이 준다)
    voters: dict[int, list[dict]] = {}
    if candidates:
        for cand_id, uid, nick in db.execute(
            select(MeetingVote.candidate_id, User.id, User.nickname)
            .join(User, User.id == MeetingVote.user_id)
            .where(MeetingVote.candidate_id.in_([c.id for c in candidates]))
            .order_by(MeetingVote.id)
        ).all():
            voters.setdefault(cand_id, []).append({"user_id": uid, "nickname": nick})

    return [
        {
            **candidate_to_dict(candidate, counts.get(candidate.id, 0)),
            "voted_by_me": candidate.id in my_votes,
            "voters": voters.get(candidate.id, []),
        }
        for candidate in candidates
    ]


# --------------------
# 후보 삭제: 그룹 멤버 가능
# --------------------

@router.delete(
    "/groups/{group_id}/meeting-candidates/{candidate_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_candidate(
    group_id: int,
    candidate_id: int,
    member=Depends(require_group_member),
    db: DbSession = Depends(get_db),
):
    candidate = db.scalar(
        select(MeetingCandidate).where(
            MeetingCandidate.id == candidate_id,
            MeetingCandidate.group_id == group_id,
        )
    )

    if candidate is None:
        raise HTTPException(
            404,
            "해당 그룹의 후보를 찾을 수 없습니다.",
        )

    db.execute(
        delete(MeetingVote).where(
            MeetingVote.candidate_id == candidate_id
        )
    )

    db.delete(candidate)
    db.commit()

    return None


# --------------------
# 투표 및 투표 변경
# --------------------

@router.post(
    "/groups/{group_id}/meeting-candidates/{candidate_id}/vote"
)
def vote_candidate(
    group_id: int,
    candidate_id: int,
    member=Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    candidate = db.scalar(
        select(MeetingCandidate).where(
            MeetingCandidate.id == candidate_id,
            MeetingCandidate.group_id == group_id,
        )
    )

    if candidate is None:
        raise HTTPException(
            404,
            "해당 그룹의 후보를 찾을 수 없습니다.",
        )

    if candidate.closed:
        raise HTTPException(
            409,
            "이미 확정된 투표예요.",
        )

    # 같은 투표(poll) 안에서만 내 이전 투표를 지운다. (다른 투표의 표는 그대로)
    same_poll_ids = [
        item.id for item in poll_candidates(db, group_id, candidate.poll_id)
    ]

    db.execute(
        delete(MeetingVote).where(
            MeetingVote.user_id == user.id,
            MeetingVote.candidate_id.in_(same_poll_ids),
        )
    )

    db.add(
        MeetingVote(
            candidate_id=candidate_id,
            user_id=user.id,
        )
    )

    db.commit()

    return {
        "message": "투표가 저장되었습니다.",
        "candidate_id": candidate_id,
    }


# --------------------
# 투표 결과 확인
# --------------------

@router.get("/groups/{group_id}/meeting-vote-results")
def meeting_vote_results(
    group_id: int,
    member=Depends(require_group_member),
    db: DbSession = Depends(get_db),
):
    candidates = db.scalars(
        select(MeetingCandidate).where(
            MeetingCandidate.group_id == group_id
        )
    ).all()

    counts = get_candidate_vote_counts(
        db,
        group_id,
        candidates,
    )

    candidate_results = [
        candidate_to_dict(candidate, counts.get(candidate.id, 0))
        for candidate in candidates
    ]

    highest = max(
        (item["vote_count"] for item in candidate_results),
        default=0,
    )

    winners = [
        item for item in candidate_results
        if highest > 0 and item["vote_count"] == highest
    ]

    return {
        "candidates": candidate_results,
        "highest_vote_count": highest,
        "is_tie": len(winners) > 1,
        "winner_candidate_ids": [
            item["id"] for item in winners
        ],
    }


# --------------------
# 투표를 만든 사람의 후보 확정
# --------------------

@router.post(
    "/groups/{group_id}/meeting-candidates/{candidate_id}/confirm"
)
def confirm_candidate(
    group_id: int,
    candidate_id: int,
    resolve_tie: bool = False,
    member=Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    target = db.scalar(
        select(MeetingCandidate).where(
            MeetingCandidate.id == candidate_id,
            MeetingCandidate.group_id == group_id,
        )
    )

    if target is None:
        raise HTTPException(
            404,
            "해당 그룹의 후보를 찾을 수 없습니다.",
        )

    # 같은 투표(poll)의 후보끼리만 비교한다.
    candidates = poll_candidates(db, group_id, target.poll_id)
    candidate = target

    if candidate.closed:
        raise HTTPException(
            409,
            "이미 확정된 투표예요.",
        )

    # 확정은 방장이 아니라, 이 투표(후보)를 만든 사람만 할 수 있다.
    if candidate.created_by != user.id:
        raise HTTPException(
            403,
            "투표를 만든 사람만 약속을 확정할 수 있습니다.",
        )

    counts = get_candidate_vote_counts(
        db,
        group_id,
        candidates,
    )

    highest = max(
        (counts.get(item.id, 0) for item in candidates),
        default=0,
    )

    if highest == 0:
        raise HTTPException(
            400,
            "투표가 없어 확정할 수 없습니다.",
        )

    winners = [
        item for item in candidates
        if counts.get(item.id, 0) == highest
    ]

    # 동률인 경우 명시적인 방장 선택을 요구한다.
    if len(winners) > 1:
        if not resolve_tie:
            raise HTTPException(
                409,
                "최다 득표 후보가 동률입니다. 동률 후보 중 하나를 선택해 다시 확정해 주세요.",
            )

        if candidate.id not in {
            item.id for item in winners
        }:
            raise HTTPException(
                409,
                "선택한 후보는 최다 득표 동률 후보가 아닙니다.",
            )

    # 단독 최다 득표 후보만 확정한다.
    elif winners[0].id != candidate_id:
        raise HTTPException(
            409,
            "선택한 후보가 최다 득표 후보가 아닙니다.",
        )

    clash = find_time_conflict(db, group_id, candidate.meeting_time)
    if clash is not None:
        raise HTTPException(409, conflict_message(clash))

    meeting = Meeting(
        group_id=group_id,
        title=candidate.title,
        location=candidate.location,
        meeting_time=candidate.meeting_time,
        place_id=candidate.place_id,
        place_address=candidate.place_address,
        place_lat=candidate.place_lat,
        place_lng=candidate.place_lng,
        created_by=user.id,
        status="confirmed",
    )

    db.add(meeting)
    # 이 투표는 끝난 것으로 표시하고, 확정된 후보를 기록한다.
    for item in candidates:
        item.closed = True
        item.chosen = item.id == candidate_id
    db.commit()
    db.refresh(meeting)

    return {
        "message": "약속이 확정되었습니다.",
        "meeting": meeting_to_dict(meeting),
    }


# --------------------
# 확정된 약속 삭제: 방장 또는 약속을 확정한 사람
# (지난 기록은 따로 남는다. 기록은 지난 기록 화면에서 직접 지운다)
# --------------------

@router.delete(
    "/groups/{group_id}/meetings/{meeting_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_meeting(
    group_id: int,
    meeting_id: int,
    member=Depends(require_group_member),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    meeting = db.scalar(
        select(Meeting).where(
            Meeting.id == meeting_id,
            Meeting.group_id == group_id,
        )
    )

    if meeting is None:
        raise HTTPException(
            404,
            "해당 그룹의 약속을 찾을 수 없습니다.",
        )

    if meeting.status != "confirmed":
        raise HTTPException(
            400,
            "확정된 약속만 삭제할 수 있습니다.",
        )

    # 그룹 멤버(require_group_member 로 확인됨)라면 누구나 확정된 약속을 지울 수 있다.
    db.delete(meeting)
    db.commit()

    return None
