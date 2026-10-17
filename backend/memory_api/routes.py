"""다현 사진 테이블의 읽기 전용 조회. 테이블·컬럼을 생성/변경하지 않는다."""
import math
import os
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import MetaData, Table, inspect, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps.auth import require_group_member
from app.models import GroupMember, User

router = APIRouter(prefix="/memory/groups/{group_id}", tags=["추억지도 조회"])
LIMIT = 500
REQUIRED = {"id", "group_id", "user_id", "storage_path", "caption", "title", "memo", "batch_id", "sort_order",
            "place_id", "place_name", "place_address", "place_lat", "place_lng", "created_at"}


def storage_config():
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    bucket = os.getenv("PHOTO_BUCKET", "memory-photos")
    return url, key, bucket


def sign_paths(paths, group_id):
    url, key, bucket = storage_config()
    if not url or not key:
        return {}, "not_configured"
    # 다현이 사용한 그룹별 저장 경로만 서명한다.
    allowed = list(dict.fromkeys(path for path in paths
        if isinstance(path, str) and path.startswith(f"groups/{group_id}/photos/") and ".." not in path.split("/")))
    if not allowed:
        return {}, "ready"
    result = {}
    try:
        with httpx.Client(timeout=20) as client:
            for start in range(0, len(allowed), 100):
                response = client.post(
                    f"{url}/storage/v1/object/sign/{quote(bucket, safe='')}",
                    headers={"Authorization": f"Bearer {key}", "apikey": key},
                    json={"expiresIn": 1800, "paths": allowed[start:start + 100]},
                )
                response.raise_for_status()
                items = response.json()
                if not isinstance(items, list):
                    return {}, "unavailable"
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    path = item.get("path")
                    signed = item.get("signedURL")
                    if path in allowed and isinstance(signed, str) and signed.startswith("/object/sign/") and not item.get("error"):
                        result[path] = f"{url}/storage/v1{signed}"
    except (httpx.HTTPError, ValueError):
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
    try:
        bind = db.get_bind()
        schema = "public" if bind.dialect.name == "postgresql" else None
        if not inspect(bind).has_table("group_photos", schema=schema):
            raise HTTPException(503, "공용 DB에 다현이의 group_photos 테이블이 아직 없습니다. 테이블은 자동 생성하지 않습니다.")
        photo = Table("group_photos", MetaData(), schema=schema, autoload_with=bind)
        if not REQUIRED.issubset(photo.c.keys()):
            raise HTTPException(503, "사진 테이블의 장소 관련 컬럼 구성이 다현 버전과 다릅니다. 담당자에게 스키마를 확인해 주세요.")
        # 반드시 해당 그룹 사진만 읽는다. 장소가 없는 사진은 추억지도 대상에서 제외.
        rows = db.execute(select(photo).where(
            photo.c.group_id == group_id,
            photo.c.place_lat.is_not(None), photo.c.place_lng.is_not(None), photo.c.place_name.is_not(None),
        ).order_by(photo.c.created_at.desc(), photo.c.id.desc()).limit(LIMIT + 1)).mappings().all()
        limited = len(rows) > LIMIT
        rows = rows[:LIMIT]
        user_ids = {row["user_id"] for row in rows if row["user_id"] is not None}
        nicknames = dict(db.execute(select(User.id, User.nickname).where(User.id.in_(user_ids))).all()) if user_ids else {}
    except SQLAlchemyError:
        raise HTTPException(503, "사진 DB 조회에 실패했습니다. 기존 DB 연결과 사진 테이블을 확인해 주세요.") from None

    urls, storage_state = sign_paths([row["storage_path"] for row in rows], group_id) if rows else ({}, "ready")
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
