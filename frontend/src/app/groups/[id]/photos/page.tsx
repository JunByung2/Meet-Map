"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PhotoShell from "@/components/PhotoShell";
import PhotoCollage from "@/components/PhotoCollage";
import MemoryTabs from "@/components/MemoryTabs";
import PhotoCalendar, { type DayCell } from "@/components/PhotoCalendar";
import { api } from "@/lib/api";
import type { MeetingRecord } from "@/lib/records";
import { formatDate, formatDayHeading, groupByDay, groupLabel, groupPhotos, kstDay, type DayCover, type Photo, type PhotoGroup } from "@/lib/photos";
import { buildCalendarDays, recordsByDayOf } from "@/lib/photoCalendar";
import CalIcon from "@/components/CalIcon";

export default function GroupPhotosPage() {
  return (
    <PhotoShell>
      {({ groupId, onApiError }) => <Gallery groupId={groupId} onApiError={onApiError} />}
    </PhotoShell>
  );
}

function Gallery({ groupId, onApiError }: { groupId: string; onApiError: (e: unknown) => string }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [records, setRecords] = useState<MeetingRecord[]>([]); // 달력에 약속 기록이 있는 날을 표시하는 데 쓴다
  const [covers, setCovers] = useState<DayCover[]>([]); // 날짜별 대표 사진 (정해 두지 않은 날은 그날 첫 사진)
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "chat" | "record">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [calOpen, setCalOpen] = useState(false); // 달력 시트
  const [dayFilter, setDayFilter] = useState<string | null>(null); // 달력에서 고른 날짜 (YYYY-MM-DD)

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // 약속 기록은 달력 표시용이라, 못 불러와도 사진 목록은 그대로 보여 준다
      const [list, recs, cov] = await Promise.all([
        api<Photo[]>(`/groups/${groupId}/photos`),
        api<MeetingRecord[]>(`/groups/${groupId}/records`).catch(() => [] as MeetingRecord[]),
        api<DayCover[]>(`/groups/${groupId}/photos/day-covers`).catch(() => [] as DayCover[]),
      ]);
      setPhotos(list);
      setRecords(recs);
      setCovers(cov);
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

  // 추억 화면의 달력에서 "이 날 사진 보기"로 넘어오면 그 날짜만 보이게 한다 (?day=YYYY-MM-DD)
  useEffect(() => {
    try {
      const day = new URLSearchParams(window.location.search).get("day");
      if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) setDayFilter(day);
    } catch {
      // 주소를 못 읽으면 그냥 전체를 보여 준다
    }
  }, []);

  const chatCount = photos.filter((p) => p.from_chat).length;
  const shown = useMemo(
    () => (tab === "all" ? photos : photos.filter((p) => (tab === "chat" ? !!p.from_chat : !p.from_chat))),
    [photos, tab],
  );
  const groups = useMemo(() => groupPhotos(shown), [shown]);
  // 달력에 보여 줄 날짜별 정보: 사진 장수, 대표 사진, 약속 기록 여부
  const recordsByDay = useMemo(() => recordsByDayOf(records), [records]);
  const calendarDays = useMemo(() => buildCalendarDays(groups, covers, recordsByDay), [groups, covers, recordsByDay]);
  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    const byDay = dayFilter ? groups.filter((g) => kstDay(g.created_at) === dayFilter) : groups;
    if (!q) return byDay;
    return byDay.filter((g) =>
      [g.title, g.memo, ...g.photos.map((p) => p.caption)].some((t) => (t || "").toLocaleLowerCase().includes(q)),
    );
  }, [groups, search, dayFilter]);
  const days = useMemo(() => groupByDay(visible), [visible]);
  const visibleCount = visible.reduce((sum, g) => sum + g.photos.length, 0);

  async function removeGroup(g: PhotoGroup) {
    const n = g.photos.length;
    const q = n > 1 ? `함께 올린 사진 ${n}장을 모두 삭제할까요?\n모든 팀원에게서 지워지고, 복구할 수 없어요.` : "이 사진을 삭제할까요?\n모든 팀원에게서 지워지고, 복구할 수 없어요.";
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

  // ---- 여러 묶음을 골라서 한 번에 삭제 ----
  const MAX_SELECT = 50; // 서버가 한 번에 받는 최대 묶음 수
  const deletable = visible.filter((g) => g.can_edit);

  function toggle(key: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else if (next.size < MAX_SELECT) next.add(key);
      else setError(`한 번에 최대 ${MAX_SELECT}묶음까지 선택할 수 있어요.`);
      return next;
    });
  }

  function leaveSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function removeSelected() {
    const picked = photos.length ? groupPhotos(photos).filter((g) => selected.has(g.key)) : [];
    if (!picked.length) return;
    const count = picked.reduce((sum, g) => sum + g.photos.length, 0);
    const hasChat = picked.some((g) => g.photos.some((p) => p.from_chat));
    const q =
      `선택한 ${picked.length}묶음(사진 ${count}장)을 삭제할까요?\n모든 팀원에게서 지워지고, 복구할 수 없어요.` +
      (hasChat ? "\n채팅으로 보낸 사진은 채팅방에서도 함께 지워져요." : "");
    if (!window.confirm(q)) return;
    setError("");
    setMessage("");
    setDeleting(true);
    try {
      const res = await api<{ deleted: string[]; skipped: string[] }>(`/groups/${groupId}/photos/bulk-delete`, {
        method: "POST",
        body: { batch_ids: picked.map((g) => g.key) },
      });
      const gone = new Set(res.deleted);
      setPhotos((cur) => cur.filter((p) => !gone.has(p.batch_id)));
      setSelected(new Set(res.skipped));
      setMessage(
        res.skipped.length
          ? `${res.deleted.length}묶음을 삭제했어요. ${res.skipped.length}묶음은 올린 사람이나 방장만 지울 수 있어요.`
          : `${res.deleted.length}묶음을 삭제했어요.`,
      );
      if (!res.skipped.length) leaveSelect();
    } catch (e) {
      setError(onApiError(e));
    } finally {
      setDeleting(false);
    }
  }

  const base = `/groups/${groupId}/photos`;

  return (
    <>
      <MemoryTabs
        groupId={groupId}
        current="photos"
        sub="함께 찍은 사진을 모아 두면 그룹 친구들만 볼 수 있어요."
        action={
          <Link className="btn" href={`${base}/upload`}>
            + 사진 올리기
          </Link>
        }
      />

      <div className="ph-toolbar">
        <div className="ph-tabs" role="tablist" aria-label="사진 분류">
          {(
            [
              ["all", "전체", photos.length],
              ["chat", "채팅 사진", chatCount],
              ["record", "기록 사진", photos.length - chatCount],
            ] as const
          ).map(([key, label, n]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}>
              {label} {n}
            </button>
          ))}
        </div>
        {photos.length > 0 && (
          <button
            type="button"
            className={`ph-cal-btn${dayFilter ? " on" : ""}`}
            aria-label="달력으로 사진 보기"
            title="달력으로 보기"
            onClick={() => setCalOpen(true)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="3" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
          </button>
        )}
        {dayFilter && (
          <button type="button" className="ph-day-chip" onClick={() => setDayFilter(null)} aria-label="날짜 선택 해제">
            <CalIcon /> {formatDayHeading(dayFilter).replace(/^\d+년 /, "")} ✕
          </button>
        )}
        {photos.length > 0 &&
          (selectMode ? (
            <button type="button" className="btn secondary sm" onClick={leaveSelect}>
              선택 끝내기
            </button>
          ) : (
            <button type="button" className="btn secondary sm" onClick={() => setSelectMode(true)}>
              ☑ 선택해서 삭제
            </button>
          ))}
        <input
          className="ph-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="사진 제목, 메모, 설명으로 검색"
          aria-label="사진 검색"
        />
      </div>

      {dayFilter && (recordsByDay.get(dayFilter)?.length ?? 0) > 0 && (
        <div className="ph-day-records">
          {recordsByDay.get(dayFilter)?.map((r) => (
            <Link key={r.id} href={`/groups/${groupId}/records/${r.id}`}>
              📌 {r.title}
              {r.place_name ? ` · 📍 ${r.place_name}` : ""}
              <span aria-hidden="true"> →</span>
            </Link>
          ))}
        </div>
      )}

      {error && (
        <div className="error">
          {error}{" "}
          <button className="ph-link-btn" onClick={() => load()}>
            다시 시도
          </button>
        </div>
      )}
      {message && <p className="ph-ok">{message}</p>}
      {selectMode && (
        <p className="ph-select-hint">
          지울 사진을 눌러서 고르세요. 내가 올리지 않은 사진은 방장만 고를 수 있어요. (한 번에 최대 {MAX_SELECT}묶음)
        </p>
      )}

      {loading ? (
        <div className="ph-grid" aria-busy="true" aria-label="사진을 불러오는 중이에요">
          {[0, 1, 2, 3].map((i) => (
            <div className="ph-card" key={i}>
              <div className="ph-collage sk" />
              <div className="ph-card-body">
                <span className="sk sk-line" style={{ width: "70%", height: 16 }} />
                <span className="sk sk-line" style={{ width: "45%", marginTop: 10 }} />
              </div>
            </div>
          ))}
        </div>
      ) : visible.length ? (
        <>
          <div className="ph-section">
            <h2>
              전체 사진 {visibleCount}장 · {visible.length}묶음
            </h2>
            <span className="meta">날짜별로 묶어서 보여줘요</span>
          </div>
          {days.map((d) => (
          <section key={d.day} className="ph-day">
          <h3 className="ph-day-head">
            {formatDayHeading(d.day)} <span>{d.groups.reduce((s, g) => s + g.photos.length, 0)}장</span>
          </h3>
          <div className={`ph-grid${selectMode ? " ph-select-on" : ""}`}>
            {d.groups.map((g) => {
              const href = `${base}/${g.photos[0].id}`;
              const picked = selected.has(g.key);
              return (
                <article
                  className={`ph-card${picked ? " sel" : ""}${selectMode && !g.can_edit ? " dim" : ""}`}
                  key={g.key}
                  onClickCapture={(e) => {
                    if (!selectMode) return;
                    e.preventDefault(); // 선택하는 중에는 상세 화면으로 넘어가지 않는다
                    if (g.can_edit) toggle(g.key);
                  }}
                >
                  {selectMode && g.can_edit && <span className="ph-check" aria-hidden="true">{picked ? "✓" : ""}</span>}
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
                      {g.can_edit && !selectMode && (
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
          </section>
          ))}
          {selectMode && (
            <div className="ph-select-bar" role="toolbar" aria-label="선택한 사진 삭제">
              <span className="grow">{selected.size}묶음 선택됨</span>
              <button
                type="button"
                className="btn secondary sm"
                onClick={() =>
                  setSelected(
                    selected.size >= Math.min(deletable.length, MAX_SELECT)
                      ? new Set()
                      : new Set(deletable.slice(0, MAX_SELECT).map((g) => g.key)),
                  )
                }
              >
                {selected.size >= Math.min(deletable.length, MAX_SELECT) && deletable.length > 0 ? "선택 해제" : "전체 선택"}
              </button>
              <button type="button" className="btn secondary sm" onClick={leaveSelect}>
                취소
              </button>
              <button type="button" className="btn sm" disabled={!selected.size || deleting} onClick={() => void removeSelected()}>
                {deleting ? "삭제하는 중…" : `삭제 (${selected.size})`}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="card ph-empty">
          <h3>{dayFilter ? "이 날은 사진이 없어요" : search ? "검색 결과가 없어요" : tab === "chat" ? "채팅으로 보낸 사진이 없어요" : tab === "record" ? "직접 올린 사진이 없어요" : "아직 모아 둔 사진이 없어요"}</h3>
          <p>{dayFilter ? "달력에서 다른 날을 고르거나 날짜 선택을 해제해 보세요." : search ? "다른 말로 검색해 보세요." : "첫 사진을 올려서 소중한 순간을 기록해 보세요."}</p>
          {!search && !dayFilter && (
            <Link className="btn" href={`${base}/upload`}>
              첫 사진 올리기
            </Link>
          )}
        </div>
      )}
      {calOpen && (
        <PhotoCalendar days={calendarDays} selected={dayFilter} onSelect={setDayFilter} onClose={() => setCalOpen(false)} />
      )}
    </>
  );
}
