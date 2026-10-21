"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PhotoShell from "@/components/PhotoShell";
import PhotoCollage from "@/components/PhotoCollage";
import { api } from "@/lib/api";
import { formatDate, groupLabel, groupPhotos, type Photo, type PhotoGroup } from "@/lib/photos";

export default function GroupPhotosPage() {
  return (
    <PhotoShell>
      {({ groupId, onApiError }) => <Gallery groupId={groupId} onApiError={onApiError} />}
    </PhotoShell>
  );
}

function Gallery({ groupId, onApiError }: { groupId: string; onApiError: (e: unknown) => string }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPhotos(await api<Photo[]>(`/groups/${groupId}/photos`));
    } catch (e) {
      setError(onApiError(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => groupPhotos(photos), [photos]);
  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    if (!q) return groups;
    return groups.filter((g) =>
      [g.title, g.memo, ...g.photos.map((p) => p.caption)].some((t) => (t || "").toLocaleLowerCase().includes(q)),
    );
  }, [groups, search]);
  const visibleCount = visible.reduce((sum, g) => sum + g.photos.length, 0);

  async function removeGroup(g: PhotoGroup) {
    const n = g.photos.length;
    const q = n > 1 ? `함께 올린 사진 ${n}장을 모두 삭제할까요? 삭제한 사진은 복구할 수 없어요.` : "이 사진을 삭제할까요? 삭제한 사진은 복구할 수 없어요.";
    if (!window.confirm(q)) return;
    setError("");
    setMessage("");
    try {
      await api(`/groups/${groupId}/photos/batch/${g.key}`, { method: "DELETE" });
      setPhotos((cur) => cur.filter((p) => p.batch_id !== g.key));
      setMessage(n > 1 ? `사진 ${n}장을 삭제했어요.` : "사진을 삭제했어요.");
    } catch (e) {
      setError(onApiError(e));
    }
  }

  const base = `/groups/${groupId}/photos`;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">우리 그룹의 사진 공간</p>
          <h1 className="page-title">우리의 순간, 한 장씩</h1>
          <p className="page-sub">함께 찍은 사진을 모아 두면 그룹 친구들만 볼 수 있어요.</p>
        </div>
        <Link className="btn" href={`${base}/upload`}>
          + 사진 올리기
        </Link>
      </div>

      <div className="ph-toolbar">
        <span className="chip">전체 사진 {photos.length}</span>
        <input
          className="ph-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="사진 제목, 메모, 설명으로 검색"
          aria-label="사진 검색"
        />
      </div>

      {error && (
        <div className="error">
          {error}{" "}
          <button className="ph-link-btn" onClick={() => load()}>
            다시 시도
          </button>
        </div>
      )}
      {message && <p className="ph-ok">{message}</p>}

      {loading ? (
        <div className="card muted">사진을 불러오는 중이에요.</div>
      ) : visible.length ? (
        <>
          <div className="ph-section">
            <h2>그날의 사진을 모아 보기</h2>
          </div>
          <div className="ph-strip">
            {visible.slice(0, 5).map((g) => (
              <Link href={`${base}/${g.photos[0].id}`} className="ph-strip-item" key={`recent-${g.key}`}>
                <PhotoCollage group={g} wide alt={groupLabel(g)} />
                <strong>{groupLabel(g)}</strong>
                <span>{formatDate(g.created_at)}</span>
              </Link>
            ))}
          </div>

          <div className="ph-section">
            <h2>
              전체 사진 {visibleCount}장 · {visible.length}묶음
            </h2>
            <span className="meta">최근 등록순</span>
          </div>
          <div className="ph-grid">
            {visible.map((g) => {
              const href = `${base}/${g.photos[0].id}`;
              return (
                <article className="ph-card" key={g.key}>
                  <Link href={href}>
                    <PhotoCollage group={g} alt={groupLabel(g)} />
                  </Link>
                  <div className="ph-card-body">
                    <Link href={href} className="ph-card-title">
                      {groupLabel(g)}
                    </Link>
                    {g.memo?.trim() && <p className="ph-card-memo">{g.memo.trim()}</p>}
                    <p className="ph-card-meta">
                      {g.place ? `📍 ${g.place.name} · ` : ""}
                      {g.uploader ?? "알 수 없음"} · {formatDate(g.created_at)}
                      {g.photos.length > 1 && ` · ${g.photos.length}장`}
                    </p>
                    <div className="ph-card-actions">
                      <Link href={href} className="link-arrow">
                        {g.photos.length > 1 ? "묶음 보기 →" : "사진 상세 보기 →"}
                      </Link>
                      {g.can_edit && (
                        <button type="button" className="ph-link-btn danger" onClick={() => removeGroup(g)}>
                          삭제
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <div className="card ph-empty">
          <h3>{search ? "검색 결과가 없어요" : "아직 모아 둔 사진이 없어요"}</h3>
          <p>{search ? "다른 말로 검색해 보세요." : "첫 사진을 올려서 소중한 순간을 기록해 보세요."}</p>
          {!search && (
            <Link className="btn" href={`${base}/upload`}>
              첫 사진 올리기
            </Link>
          )}
        </div>
      )}
    </>
  );
}
