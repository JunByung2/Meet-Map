"""Supabase Storage(비공개 버킷) 연결 — service_role 키로 서버에서만 호출한다.

필요한 Storage REST API 는 네 가지뿐이라 별도 SDK 없이 httpx 로 직접 호출한다.
  - 업로드  POST   /storage/v1/object/{bucket}/{path}
  - 삭제    DELETE /storage/v1/object/{bucket}            (body: {"prefixes": [...]})
  - 임시주소 POST   /storage/v1/object/sign/{bucket}       (body: {"expiresIn": 초, "paths": [...]})
"""
from urllib.parse import quote

import httpx

from app.config import PHOTO_BUCKET, PHOTO_SIGNED_URL_SECONDS, SUPABASE_SERVICE_KEY, SUPABASE_URL


class StorageError(Exception):
    pass


def is_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_KEY)


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {SUPABASE_SERVICE_KEY}", "apikey": SUPABASE_SERVICE_KEY}


def _api(path: str) -> str:
    return f"{SUPABASE_URL}/storage/v1{path}"


def _enc(path: str) -> str:
    return quote(path, safe="/")


def upload(path: str, data: bytes, content_type: str) -> None:
    try:
        res = httpx.post(
            _api(f"/object/{PHOTO_BUCKET}/{_enc(path)}"),
            content=data,
            headers={**_headers(), "Content-Type": content_type, "x-upsert": "false", "cache-control": "max-age=3600"},
            timeout=60,
        )
    except httpx.HTTPError as e:
        raise StorageError(f"Storage 연결 실패: {e}") from e
    if res.status_code >= 300:
        raise StorageError(f"Storage 업로드 실패({res.status_code}): {res.text[:200]}")


def remove(paths: list[str]) -> None:
    if not paths:
        return
    try:
        res = httpx.request(
            "DELETE",
            _api(f"/object/{PHOTO_BUCKET}"),
            json={"prefixes": paths},
            headers=_headers(),
            timeout=30,
        )
    except httpx.HTTPError as e:
        raise StorageError(f"Storage 연결 실패: {e}") from e
    if res.status_code >= 300:
        raise StorageError(f"Storage 삭제 실패({res.status_code}): {res.text[:200]}")


def signed_urls(paths: list[str]) -> dict[str, str]:
    """{storage_path: 임시 주소}. 한 번의 호출로 여러 장을 발급받는다. 실패한 경로는 결과에서 빠진다."""
    if not paths:
        return {}
    try:
        res = httpx.post(
            _api(f"/object/sign/{PHOTO_BUCKET}"),
            json={"expiresIn": PHOTO_SIGNED_URL_SECONDS, "paths": paths},
            headers=_headers(),
            timeout=30,
        )
    except httpx.HTTPError as e:
        raise StorageError(f"Storage 연결 실패: {e}") from e
    if res.status_code >= 300:
        raise StorageError(f"Storage 주소 발급 실패({res.status_code}): {res.text[:200]}")
    out: dict[str, str] = {}
    for item in res.json():
        signed = item.get("signedURL")
        if item.get("path") and signed and not item.get("error"):
            # 응답의 signedURL 은 /object/sign/... 로 시작하므로 /storage/v1 을 앞에 붙인다
            out[item["path"]] = f"{SUPABASE_URL}/storage/v1{signed}"
    return out


def public_style_url(path: str) -> str:
    """photos.url 컬럼에 기록용으로 저장하는 고정 주소 (버킷이 비공개라 직접 열리지는 않는다)."""
    return f"{SUPABASE_URL}/storage/v1/object/public/{PHOTO_BUCKET}/{_enc(path)}"
