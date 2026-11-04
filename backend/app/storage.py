"""Supabase Storage(비공개 버킷) 연결 — service_role 키로 서버에서만 호출한다.

필요한 Storage REST API 는 네 가지뿐이라 별도 SDK 없이 httpx 로 직접 호출한다.
  - 업로드  POST   /storage/v1/object/{bucket}/{path}
  - 삭제    DELETE /storage/v1/object/{bucket}            (body: {"prefixes": [...]})
  - 임시주소 POST   /storage/v1/object/sign/{bucket}       (body: {"expiresIn": 초, "paths": [...]})
  - 내려받기 GET    /storage/v1/object/{bucket}/{path}     (비공개 버킷은 service_role 키로 서버가 대신 받아 준다)
"""
import threading
import time
from urllib.parse import quote

import httpx

from app.config import PHOTO_BUCKET, PHOTO_SIGNED_URL_SECONDS, SUPABASE_SERVICE_KEY, SUPABASE_URL


class StorageError(Exception):
    pass


# 연결을 재사용한다. 요청마다 새로 연결(TLS 악수)하지 않아서 사진을 여러 장 올릴 때 장당 수백 ms 가 줄어든다.
_client = httpx.Client(limits=httpx.Limits(max_keepalive_connections=20, max_connections=40))


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
        res = _client.post(
            _api(f"/object/{PHOTO_BUCKET}/{_enc(path)}"),
            content=data,
            headers={**_headers(), "Content-Type": content_type, "x-upsert": "false", "cache-control": "max-age=3600"},
            timeout=60,
        )
    except httpx.HTTPError as e:
        raise StorageError(f"Storage 연결 실패: {e}") from e
    if res.status_code >= 300:
        raise StorageError(f"Storage 업로드 실패({res.status_code}): {res.text[:200]}")


def download(path: str) -> tuple[bytes, str | None]:
    """저장소의 원본 파일을 서버가 대신 받아 (내용, Content-Type) 으로 돌려준다. 파일 다운로드 버튼에서 쓴다."""
    try:
        res = httpx.get(_api(f"/object/{PHOTO_BUCKET}/{_enc(path)}"), headers=_headers(), timeout=60)
    except httpx.HTTPError as e:
        raise StorageError(f"Storage 연결 실패: {e}") from e
    if res.status_code == 404 or res.status_code == 400:
        raise StorageError("저장소에서 사진 파일을 찾을 수 없어요.")
    if res.status_code >= 300:
        raise StorageError(f"Storage 다운로드 실패({res.status_code}): {res.text[:200]}")
    return res.content, res.headers.get("content-type")


def remove(paths: list[str]) -> None:
    if not paths:
        return
    with _signed_lock:  # 지운 사진의 임시 주소는 더 쓰지 않는다
        for p in paths:
            _signed_cache.pop(p, None)
    try:
        res = _client.request(
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


# 임시 주소를 서버가 기억해 둔다.
# - 같은 사진을 볼 때마다 저장소(Supabase)에 다시 요청하지 않아도 되고,
# - 주소가 그대로라서 브라우저도 이미 받은 사진을 다시 내려받지 않는다.
_signed_cache: dict[str, tuple[float, str]] = {}
_signed_lock = threading.Lock()
_SIGNED_REUSE_MARGIN = 300  # 만료 5분 전까지만 다시 쓴다
_SIGNED_CACHE_MAX = 5000


def clear_signed_cache() -> None:
    with _signed_lock:
        _signed_cache.clear()


def signed_urls(paths: list[str]) -> dict[str, str]:
    """{storage_path: 임시 주소}. 한 번의 호출로 여러 장을 발급받는다. 실패한 경로는 결과에서 빠진다."""
    if not paths:
        return {}
    now = time.monotonic()
    out: dict[str, str] = {}
    missing: list[str] = []
    with _signed_lock:
        for p in dict.fromkeys(paths):
            hit = _signed_cache.get(p)
            if hit is not None and hit[0] > now:
                out[p] = hit[1]
            else:
                missing.append(p)
    if not missing:
        return out

    fetched = _request_signed_urls(missing)
    keep = max(60, PHOTO_SIGNED_URL_SECONDS - _SIGNED_REUSE_MARGIN)
    with _signed_lock:
        if len(_signed_cache) > _SIGNED_CACHE_MAX:
            for k in [k for k, (exp, _) in _signed_cache.items() if exp <= now]:
                _signed_cache.pop(k, None)
            if len(_signed_cache) > _SIGNED_CACHE_MAX:
                _signed_cache.clear()
        for p, url in fetched.items():
            _signed_cache[p] = (now + keep, url)
    out.update(fetched)
    return out


def _request_signed_urls(paths: list[str]) -> dict[str, str]:
    try:
        res = _client.post(
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
