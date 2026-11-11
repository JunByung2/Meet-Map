"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PhotoCalendar from "@/components/PhotoCalendar";
import { MemoryMapPreview } from "@/features/memory/MemoryMap";
import { api } from "@/lib/api";
import { formatMeetDate, type MeetingRecord } from "@/lib/records";
import { groupPhotos, type DayCover, type Photo } from "@/lib/photos";
import { buildCalendarDays, recordsByDayOf } from "@/lib/photoCalendar";
import "./memories.css";

/** 지도는 화면에 가까워졌을 때만 불러온다 (처음 화면이 가볍도록) */
function useNearScreen<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return [ref, near] as const;
}

/**
 * 추억 화면: 탭으로 갈아타지 않고 지난 기록(달력) · 추억지도 · 사진을 한 페이지에 정리해 보여 준다.
 * PC 는 두 칸(왼쪽 지난 기록, 오른쪽 지도+사진), 모바일은 한 칸으로 쌓는다.
 */
export default function MemoryHome({ groupId, onApiError }: { groupId: string; onApiError: (e: unknown) => string }) {
  const router = useRouter();
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [records, setRecords] = useState<MeetingRecord[] | null>(null);
  const [covers, setCovers] = useState<DayCover[]>([]);
  const [error, setError] = useState("");
  const [mapRef, mapNear] = useNearScreen<HTMLDivElement>();

  useEffect(() => {
    let cancelled = false;
    api<Photo[]>(`/groups/${groupId}/photos`)
      .then((l) => !cancelled && setPhotos(l))
      .catch((e) => {
        if (cancelled) return;
        setError(onApiError(e));
        setPhotos([]);
      });
    api<MeetingRecord[]>(`/groups/${groupId}/records`)
      .then((l) => !cancelled && setRecords(l))
      .catch(() => !cancelled && setRecords([]));
    api<DayCover[]>(`/groups/${groupId}/photos/day-covers`)
      .then((l) => !cancelled && setCovers(l))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const groups = useMemo(() => groupPhotos(photos ?? []), [photos]);
  const recordsByDay = useMemo(() => recordsByDayOf(records ?? []), [records]);
  const days = useMemo(() => buildCalendarDays(groups, covers, recordsByDay), [groups, covers, recordsByDay]);
  const tiles = useMemo(
    () => groups.filter((g) => g.photos[0]?.signed_url).slice(0, 12),
    [groups],
  );
  const recent = (records ?? []).slice(0, 3);

  return (
    <div className="mh-grid">
      <section className="card mh-records">
        <div className="mh-title">
          <h2>지난 기록</h2>
          <Link href={`/groups/${groupId}/records`}>모두 보기 →</Link>
        </div>
        <p className="mh-sub">날짜를 누르면 그날의 사진을 볼 수 있어요.</p>
        <PhotoCalendar
          inline
          days={days}
          selected={null}
          onSelect={(d) => d && router.push(`/groups/${groupId}/photos?day=${d}`)}
          onClose={() => undefined}
        />
        {error && <div className="error">{error}</div>}
        {records === null ? (
          <div className="mh-skel" style={{ height: 120, marginTop: 14 }} aria-busy="true" />
        ) : recent.length === 0 ? (
          <p className="muted" style={{ marginTop: 14 }}>
            약속이 확정되면 지난 기록이 여기에 자동으로 생겨요.
          </p>
        ) : (
          <ul className="mh-recs">
            {recent.map((r) => (
              <li key={r.id}>
                <Link href={`/groups/${groupId}/records/${r.id}`}>
                  <span className="mh-rec-cover">
                    {r.cover_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.cover_url} alt="" loading="lazy" decoding="async" />
                    ) : null}
                  </span>
                  <span className="mh-rec-body">
                    <small>{formatMeetDate(r.meet_date)}</small>
                    <strong>{r.title}</strong>
                    <em>📍 {r.place_name ?? "장소 미정"}</em>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mh-side">
      <section className="card mh-map" ref={mapRef}>
        <div className="mh-title">
          <h2>추억지도</h2>
          <Link href={`/groups/${groupId}/map?view=memory`}>크게 보기 →</Link>
        </div>
        {mapNear ? <MemoryMapPreview groupId={groupId} height="300px" /> : <div className="mh-skel" style={{ height: 300 }} />}
      </section>

      <section className="card mh-photos">
        <div className="mh-title">
          <h2>사진</h2>
          <span className="mh-actions">
            <Link className="btn sm" href={`/groups/${groupId}/photos/upload`}>
              + 사진 올리기
            </Link>
            <Link href={`/groups/${groupId}/photos`}>전체 보기 →</Link>
          </span>
        </div>
        {photos === null ? (
          <div className="mh-skel" style={{ height: 160 }} aria-busy="true" />
        ) : tiles.length === 0 ? (
          <p className="muted">아직 올린 사진이 없어요.</p>
        ) : (
          <div className="mh-tiles">
            {tiles.map((g) => (
              <Link key={g.key} href={`/groups/${groupId}/photos/${g.photos[0].id}`} className="mh-tile">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.photos[0].signed_url ?? ""} alt={g.title ?? "사진"} loading="lazy" decoding="async" />
                {g.photos.length > 1 && <span>{g.photos.length}</span>}
              </Link>
            ))}
          </div>
        )}
      </section>
      </div>
    </div>
  );
}
