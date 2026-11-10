"""다현 사진 테이블의 읽기 전용 조회. 테이블·컬럼을 생성/변경하지 않는다."""
import math
import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps.auth import require_group_member
from app.models import GroupMember, User, Photo
from app import storage

router = APIRouter(prefix="/memory/groups/{group_id}", tags=["추억지도 조회"])
logger = logging.getLogger("meetmap.memory")
LIMIT = 500
REQUIRED = {"id", "group_id", "user_id", "storage_path", "caption", "title", "memo", "batch_id", "sort_order",
            "place_id", "place_name", "place_address", "place_lat", "place_lng", "created_at"}


def sign_paths(paths, group_id):
    if not storage.is_configured():
        return {}, "not_configured"
    allowed = list(dict.fromkeys(path for path in paths
        if isinstance(path, str) and path.startswith(f"groups/{group_id}/photos/")
        and ".." not in path.split("/")))
    if not allowed:
        return {}, "ready"
    try:
        # 사진 페이지와 동일한 주소 캐시·HTTP 연결을 재사용한다.
        result = storage.signed_urls(allowed)
    except (storage.StorageError, ValueError, TypeError):
        return {}, "unavailable"
    return result, "ready" if len(result) == len(allowed) else "partial"


@router.get("/photos")
def memory_photos(
    group_id: int,
    response: Response,
    member: GroupMember = Depends(require_group_member),
    db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "private, no-store"
    started = time.perf_counter()
    try:
        # 필요한 컬럼만 선택한다. 매 요청의 테이블 구조 재조회는 하지 않는다.
        photo = Photo.__table__
        # 반드시 해당 그룹 사진만 읽는다. 장소가 없는 사진은 추억지도 대상에서 제외.
        rows = db.execute(select(*(photo.c[key] for key in sorted(REQUIRED))).where(
            photo.c.group_id == group_id,
            photo.c.place_lat.is_not(None), photo.c.place_lng.is_not(None), photo.c.place_name.is_not(None),
        ).order_by(photo.c.created_at.desc(), photo.c.id.desc()).limit(LIMIT + 1)).mappings().all()
        limited = len(rows) > LIMIT
        rows = rows[:LIMIT]
        user_ids = {row["user_id"] for row in rows if row["user_id"] is not None}
        nicknames = dict(db.execute(select(User.id, User.nickname).where(User.id.in_(user_ids))).all()) if user_ids else {}
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(503, "사진 DB 조회에 실패했습니다. 기존 DB 연결과 사진 테이블을 확인해 주세요.") from None

    db_ms = (time.perf_counter() - started) * 1000
    # 데이터가 일반 값으로 읽힌 뒤 연결을 반환한다. 외부 저장소 대기 중 DB를 점유하지 않는다.
    db.close()
    signing_started = time.perf_counter()
    urls, storage_state = sign_paths([row["storage_path"] for row in rows], group_id) if rows else ({}, "ready")
    storage_ms = (time.perf_counter() - signing_started) * 1000
    response.headers["Server-Timing"] = f"db;dur={db_ms:.1f}, storage;dur={storage_ms:.1f}"
    if db_ms + storage_ms >= 500:
        logger.warning("[추억지도 시간] db=%.0fms storage=%.0fms photos=%s", db_ms, storage_ms, len(rows))
    photos = []
    for row in rows:
        lat, lng = row["place_lat"], row["place_lng"]
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            continue
        if not math.isfinite(lat) or not math.isfinite(lng) or abs(lat) > 90 or abs(lng) > 180:
            continue
        photos.append({
            key: row[key] for key in REQUIRED
        } | {"url": None, "signed_url": urls.get(row["storage_path"]),
             "uploader_nickname": nicknames.get(row["user_id"]), "can_edit": False})
    return {"photos": photos, "limited": limited, "storage_state": storage_state}
