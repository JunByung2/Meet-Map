"""
확정된 약속 → 지난 기록 자동 연결 도우미

- 지난 기록은 "확정된 약속마다 하나"씩 자동으로 만들어진다. (약속 하나에 기록 하나)
- 약속 날짜(한국 시간)에 올린 사진은 그날의 약속 기록에 자동으로 붙는다.

약속(meetings) 표는 팀원(민영) 담당이라 모델을 가져다 쓰지 않고, 표와 컬럼이 실제로 있는지 확인한 뒤 읽기만 한다.
(표나 컬럼이 없거나 모양이 달라도 기록·사진 기능은 멈추지 않는다.)
"""
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.models import MeetingRecord, Photo

KST = timezone(timedelta(hours=9))
MEETING_LIMIT = 100

# 컬럼 이름은 아래 고정된 후보 중 실제로 있는 것만 쓰므로 SQL 에 사용자 입력이 들어가지 않는다.
_TITLE_COLUMNS = ("title", "name", "subject")
_WHEN_COLUMNS = ("meeting_time", "meeting_at", "meet_at", "scheduled_at", "start_at", "starts_at", "meeting_date", "date", "datetime", "when")
_PLACE_COLUMNS = ("place_name", "place", "location_name", "location", "address")


@dataclass
class MeetingInfo:
    id: int
    title: str
    meet_date: date | None
    place_name: str | None
    place_id: str | None = None
    place_address: str | None = None
    place_lat: float | None = None
    place_lng: float | None = None


# ---------- 날짜 도우미 (약속 날짜는 한국 시간 기준) ----------
def to_kst_date(value) -> date | None:
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            try:
                return date.fromisoformat(value[:10])
            except ValueError:
                return None
    if isinstance(value, datetime):
        return value.astimezone(KST).date() if value.tzinfo is not None else value.date()
    if isinstance(value, date):
        return value
    return None


def kst_day_bounds(day: date) -> tuple[datetime, datetime]:
    """그날 0시 ~ 다음날 0시(한국 시간)를 UTC 로 바꾼 구간"""
    start = datetime(day.year, day.month, day.day, tzinfo=KST)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


# ---------- 확정된 약속 읽기 ----------
def load_confirmed_meetings(db: DbSession, group_id: int) -> list[MeetingInfo]:
    try:
        insp = inspect(db.get_bind())
        if "meetings" not in insp.get_table_names():
            return []
        columns = {c["name"] for c in insp.get_columns("meetings")}
        if not {"id", "group_id"} <= columns:
            return []

        def pick(candidates):
            return next((c for c in candidates if c in columns), None)

        title_col, when_col, place_col = pick(_TITLE_COLUMNS), pick(_WHEN_COLUMNS), pick(_PLACE_COLUMNS)
        extra = [c for c in ("place_id", "place_address", "place_lat", "place_lng") if c in columns and c != place_col]
        select_cols = ["id"] + [f'"{c}"' for c in (title_col, when_col, place_col, *extra) if c]
        where = "group_id = :g" + (" AND status = 'confirmed'" if "status" in columns else "")
        rows = db.execute(
            text(f'SELECT {", ".join(select_cols)} FROM meetings WHERE {where} ORDER BY id DESC LIMIT :n'),
            {"g": group_id, "n": MEETING_LIMIT},
        ).mappings().all()
    except Exception:  # noqa: BLE001
        db.rollback()
        return []

    out: list[MeetingInfo] = []
    for row in rows:
        mid = int(row["id"])
        title = (str(row[title_col]).strip() if title_col and row[title_col] is not None else "") or f"약속 {mid}"
        out.append(
            MeetingInfo(
                id=mid,
                title=title[:60],
                meet_date=to_kst_date(row[when_col]) if when_col else None,
                place_name=(str(row[place_col]).strip()[:100] or None) if place_col and row[place_col] else None,
                place_id=row["place_id"] if "place_id" in extra else None,
                place_address=row["place_address"] if "place_address" in extra else None,
                place_lat=row["place_lat"] if "place_lat" in extra else None,
                place_lng=row["place_lng"] if "place_lng" in extra else None,
            )
        )
    return out


# ---------- 기록 자동 생성 ----------
def ensure_record(db: DbSession, group_id: int, meeting: MeetingInfo) -> MeetingRecord:
    existing = db.scalar(select(MeetingRecord).where(MeetingRecord.group_id == group_id, MeetingRecord.meeting_id == meeting.id))
    if existing:
        return existing
    try:
        record = MeetingRecord(
            group_id=group_id,
            created_by=None,  # 자동으로 만들어진 기록 (그룹 멤버 누구나 문구를 고칠 수 있다)
            meeting_id=meeting.id,
            title=meeting.title,
            meet_date=meeting.meet_date or datetime.now(KST).date(),
            place_name=meeting.place_name,
            # 카카오 장소로 정한 약속이면 좌표까지 있어야 지도에 표시된다 (이름만 있으면 이름만 저장)
            place_id=meeting.place_id if meeting.place_lat is not None else None,
            place_address=meeting.place_address if meeting.place_lat is not None else None,
            place_lat=meeting.place_lat,
            place_lng=meeting.place_lng,
        )
        db.add(record)
        db.flush()
        db.commit()
        return record
    except IntegrityError:
        # 두 사람이 동시에 열어서 같은 기록이 두 번 만들어지려는 경우: 먼저 만들어진 것을 쓴다
        db.rollback()
        return db.scalar(select(MeetingRecord).where(MeetingRecord.group_id == group_id, MeetingRecord.meeting_id == meeting.id))


def sync_group_records(db: DbSession, group_id: int) -> None:
    """확정된 약속 중 기록이 아직 없는 것을 모두 만든다."""
    meetings = load_confirmed_meetings(db, group_id)
    if not meetings:
        return
    done = set(db.execute(select(MeetingRecord.meeting_id).where(MeetingRecord.group_id == group_id, MeetingRecord.meeting_id.is_not(None))).scalars())
    for meeting in meetings:
        if meeting.id not in done:
            ensure_record(db, group_id, meeting)


def auto_link_photos(db: DbSession, group_id: int, photos: list[Photo]) -> None:
    """오늘(한국 시간) 확정된 약속이 정확히 하나면 방금 올린 사진을 그 약속 기록에 붙인다.
    약속이 없거나 둘 이상이면 아무것도 하지 않는다 (엉뚱한 약속에 섞이지 않게). 실패해도 업로드는 그대로 성공한다."""
    try:
        today = datetime.now(KST).date()
        todays = [m for m in load_confirmed_meetings(db, group_id) if m.meet_date == today]
        if len(todays) != 1:
            return
        record = ensure_record(db, group_id, todays[0])
        if record is None or record.deleted:
            return  # 사용자가 지운 기록에는 다시 붙이지 않는다
        for p in photos:
            p.record_id = record.id
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()


# 내보내기 (테스트/다른 모듈에서 쓰는 이름)
__all__ = [
    "KST",
    "MeetingInfo",
    "to_kst_date",
    "kst_day_bounds",
    "load_confirmed_meetings",
    "ensure_record",
    "sync_group_records",
    "auto_link_photos",
]
