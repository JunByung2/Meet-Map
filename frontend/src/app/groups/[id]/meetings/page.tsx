"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import AppShell from "@/components/AppShell";
import Pager, { PAGE_SIZE, pageCount } from "@/components/Pager";
import Avatar from "@/components/Avatar";
import DateTimePicker from "@/components/chat/DateTimePicker";
import AvailabilityCalendar from "@/features/calendar/AvailabilityCalendar";
import calendarCss from "@/features/calendar/calendar.module.css";
import AvailabilityMini from "@/features/calendar/AvailabilityMini";
import board from "./meetingsBoard.module.css";
import { useGroupContext, type GroupMember } from "@/hooks/useGroupContext";
import { pickName, useNameMode, type NameMode } from "@/lib/nameMode";
import type { PlaceValue } from "@/lib/photos";
import { usePlaceSearch } from "@/lib/usePlaceSearch";
import CalIcon from "@/components/CalIcon";

type Meeting = {
  id: number;
  group_id: number;
  title: string;
  location: string;
  meeting_time: string;
  status: string;
  created_by?: number | null;
  place_id?: string | null;
  place_address?: string | null;
  place_lat?: number | null;
  place_lng?: number | null;
  participant_ids?: number[];
};

// 날짜 표시
function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// 서버 시각(ISO)을 날짜·시간 고르기 창이 쓰는 모양(YYYY-MM-DDTHH:mm, 내 시간대)으로 바꾼다
function toLocalInput(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 한국 시간 기준 날짜(YYYY-MM-DD). 약속 날짜가 오늘을 지나면 지난 기록으로 넘어간다
const KST_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function kstDay(value: string | number | Date) {
  return KST_DAY.format(new Date(value));
}
function isUpcoming(iso: string) {
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && kstDay(d) >= kstDay(Date.now());
}

const memberChip = (selected: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px 6px 6px",
  borderRadius: 999,
  border: `1.5px solid ${selected ? "#167A68" : "#cfd8d6"}`,
  background: selected ? "#e6f3f0" : "#fff",
  fontSize: 14,
  cursor: "pointer",
});

/** 확정된 약속 하나를 고치는 칸: 날짜·시간, 장소(카카오 검색), 참여한 멤버 */
function MeetingEditor({
  groupId,
  meeting,
  members,
  nameMode,
  onSaved,
  onCancel,
}: {
  groupId: number;
  meeting: Meeting;
  members: GroupMember[];
  nameMode: NameMode;
  onSaved: (updated: Meeting) => void;
  onCancel: () => void;
}) {
  const initialWhen = toLocalInput(meeting.meeting_time);
  const [when, setWhen] = useState(initialWhen);
  const [pickOpen, setPickOpen] = useState(false);
  const [picked, setPicked] = useState<PlaceValue | null>(null); // 새로 고른 장소 (없으면 기존 장소 유지)
  const [searching, setSearching] = useState(false);
  const search = usePlaceSearch();
  // 이미 나간 멤버는 고를 수 없으므로 현재 멤버만 남긴다
  const [selected, setSelected] = useState<number[]>(() =>
    (meeting.participant_ids ?? []).filter((id) =>
      members.some((m) => m.user_id === id),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const placeName = picked?.name ?? meeting.location;
  const allSelected = members.length > 0 && selected.length === members.length;

  function toggle(userId: number) {
    setSelected((cur) =>
      cur.includes(userId)
        ? cur.filter((id) => id !== userId)
        : [...cur, userId],
    );
  }

  function stopSearch() {
    setSearching(false);
    search.clear();
    search.setKeyword("");
  }

  async function save() {
    if (!when) {
      setError("약속 날짜와 시간을 정해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    const body: Record<string, unknown> = { participant_ids: selected };
    if (when !== initialWhen) body.meeting_time = new Date(when).toISOString();
    if (picked) {
      body.location = picked.name;
      body.place_id = picked.id || null;
      body.place_address = picked.address || null;
      body.place_lat = picked.lat;
      body.place_lng = picked.lng;
    }
    try {
      const updated = await api<Meeting>(
        `/groups/${groupId}/meetings/${meeting.id}`,
        {
          method: "PATCH",
          body,
        },
      );
      onSaved(updated);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "약속을 수정하지 못했어요.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <h3 className="card-title">{meeting.title} 수정</h3>

      {/* 날짜·시간 */}
      <div>
        <p className="muted" style={{ marginBottom: 6 }}>
          날짜·시간
        </p>
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => setPickOpen(true)}
        >
          <CalIcon />{" "}
          {when ? formatDate(new Date(when).toISOString()) : "날짜·시간 정하기"}
        </button>
        {pickOpen && (
          <DateTimePicker
            value={when}
            onChange={setWhen}
            onClose={() => setPickOpen(false)}
          />
        )}
      </div>

      {/* 장소 */}
      <div>
        <p className="muted" style={{ marginBottom: 6 }}>
          장소
        </p>
        {!searching ? (
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span>📍 {placeName}</span>
            <button
              type="button"
              className="btn secondary sm"
              disabled={busy}
              onClick={() => {
                search.setKeyword(placeName);
                setSearching(true);
                void search.run(placeName);
              }}
            >
              장소 변경
            </button>
          </div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input ime-ko"
                lang="ko"
                autoFocus
                value={search.keyword}
                placeholder="장소 이름을 검색해 주세요"
                aria-label="장소 검색"
                onChange={(e) => search.setKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void search.run();
                  }
                }}
              />
              <button
                type="button"
                className="btn secondary sm"
                disabled={!search.ready || search.loading}
                onClick={() => void search.run()}
              >
                {search.loading ? "…" : "검색"}
              </button>
              <button
                type="button"
                className="btn secondary sm"
                onClick={stopSearch}
              >
                취소
              </button>
            </div>
            {search.error && <p className="error">{search.error}</p>}
            {!search.error && search.message && (
              <p className="muted">{search.message}</p>
            )}
            {search.results.length > 0 && (
              <ul
                aria-label="장소 검색 결과"
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "grid",
                  gap: 6,
                  maxHeight: 240,
                  overflowY: "auto",
                }}
              >
                {search.results.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="btn secondary"
                      style={{
                        width: "100%",
                        textAlign: "left",
                        display: "grid",
                        gap: 2,
                      }}
                      onClick={() => {
                        setPicked({
                          id: r.id,
                          name: r.name,
                          address: r.address,
                          lat: r.lat,
                          lng: r.lng,
                        });
                        stopSearch();
                      }}
                    >
                      <strong>{r.name}</strong>
                      <span className="muted">{r.address}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* 참여한 멤버 */}
      <div>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <p className="muted">
            참여한 멤버 ({selected.length}/{members.length}명)
          </p>
          <button
            type="button"
            className="btn secondary sm"
            disabled={busy}
            onClick={() =>
              setSelected(allSelected ? [] : members.map((m) => m.user_id))
            }
          >
            {allSelected ? "전체 해제" : "전체 선택"}
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {members.map((m) => {
            const on = selected.includes(m.user_id);
            const name = pickName(m, nameMode);
            return (
              <button
                key={m.user_id}
                type="button"
                aria-pressed={on}
                disabled={busy}
                style={memberChip(on)}
                onClick={() => toggle(m.user_id)}
              >
                <Avatar
                  userId={m.user_id}
                  name={name}
                  image={m.profile_image}
                  size="sm"
                />
                {on ? "✓ " : ""}
                {name}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={onCancel}
        >
          취소
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || !when}
          onClick={() => void save()}
        >
          {busy ? "저장 중…" : "저장"}
        </button>
      </div>
    </div>
  );
}

/** 투표 없이 한 사람이 바로 만드는 확정 약속: 이름, 날짜·시간, 장소, 함께하는 멤버(선택) */
function MeetingCreateForm({
  groupId,
  members,
  nameMode,
  initialWhen,
  onCreated,
  onCancel,
}: {
  groupId: number;
  members: GroupMember[];
  nameMode: NameMode;
  initialWhen: string;
  onCreated: (created: Meeting) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState(initialWhen);
  const [pickOpen, setPickOpen] = useState(false);
  const [placeText, setPlaceText] = useState("");
  const [picked, setPicked] = useState<PlaceValue | null>(null); // 카카오 검색으로 고른 장소 (직접 적으면 없음)
  const [searching, setSearching] = useState(false);
  const search = usePlaceSearch();
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const allSelected = members.length > 0 && selected.length === members.length;

  function toggle(userId: number) {
    setSelected((cur) =>
      cur.includes(userId)
        ? cur.filter((id) => id !== userId)
        : [...cur, userId],
    );
  }

  async function submit() {
    if (!title.trim()) return setError("약속 이름을 적어 주세요.");
    if (!when) return setError("날짜와 시간을 정해 주세요.");
    if (!placeText.trim())
      return setError("장소를 적거나 검색해서 골라 주세요.");
    setBusy(true);
    setError("");
    const body: Record<string, unknown> = {
      title: title.trim(),
      location: placeText.trim(),
      meeting_time: new Date(when).toISOString(),
      participant_ids: selected,
    };
    if (picked && picked.name === placeText.trim()) {
      body.place_id = picked.id || null;
      body.place_address = picked.address || null;
      body.place_lat = picked.lat;
      body.place_lng = picked.lng;
    }
    try {
      const created = await api<Meeting>(`/groups/${groupId}/meetings`, {
        method: "POST",
        body,
      });
      onCreated(created);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "약속을 만들지 못했어요.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <h3 className="card-title">새 약속 만들기</h3>
      <p className="muted">
        투표 없이 바로 확정돼요. 만들면 그룹 멤버 모두에게 보여요.
      </p>

      <div>
        <p className="muted" style={{ marginBottom: 6 }}>
          약속 이름
        </p>
        <input
          className="input ime-ko"
          lang="ko"
          value={title}
          maxLength={100}
          placeholder="예: 팀플 회의, 저녁 모임"
          aria-label="약속 이름"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div>
        <p className="muted" style={{ marginBottom: 6 }}>
          날짜·시간
        </p>
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => setPickOpen(true)}
        >
          <CalIcon />{" "}
          {when ? formatDate(new Date(when).toISOString()) : "날짜·시간 정하기"}
        </button>
        {pickOpen && (
          <DateTimePicker
            value={when}
            onChange={setWhen}
            onClose={() => setPickOpen(false)}
          />
        )}
      </div>

      <div>
        <p className="muted" style={{ marginBottom: 6 }}>
          장소
        </p>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input ime-ko"
            lang="ko"
            value={placeText}
            maxLength={200}
            placeholder="장소 이름을 적고 검색해 보세요 (적기만 해도 돼요)"
            aria-label="장소"
            onChange={(e) => {
              setPlaceText(e.target.value);
              if (picked && picked.name !== e.target.value.trim())
                setPicked(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setSearching(true);
                search.setKeyword(placeText);
                void search.run(placeText);
              }
            }}
          />
          <button
            type="button"
            className="btn secondary sm"
            style={{ flexShrink: 0, whiteSpace: "nowrap" }}
            disabled={!search.ready || search.loading}
            onClick={() => {
              setSearching(true);
              search.setKeyword(placeText);
              void search.run(placeText);
            }}
          >
            {search.loading ? "…" : "검색"}
          </button>
        </div>
        {picked && (
          <p className="muted" style={{ marginTop: 6 }}>
            📍 {picked.address}
          </p>
        )}
        {searching && (
          <div style={{ marginTop: 8 }}>
            {search.error && <p className="error">{search.error}</p>}
            {!search.error && search.message && (
              <p className="muted">{search.message}</p>
            )}
            {search.results.length > 0 && (
              <ul
                aria-label="장소 검색 결과"
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "grid",
                  gap: 6,
                  maxHeight: 240,
                  overflowY: "auto",
                }}
              >
                {search.results.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="btn secondary"
                      style={{
                        width: "100%",
                        textAlign: "left",
                        display: "grid",
                        gap: 2,
                      }}
                      onClick={() => {
                        setPicked({
                          id: r.id,
                          name: r.name,
                          address: r.address,
                          lat: r.lat,
                          lng: r.lng,
                        });
                        setPlaceText(r.name);
                        setSearching(false);
                        search.clear();
                      }}
                    >
                      <strong>{r.name}</strong>
                      <span className="muted">{r.address}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <p className="muted">
            함께하는 멤버 (선택) {selected.length}/{members.length}명
          </p>
          <button
            type="button"
            className="btn secondary sm"
            disabled={busy}
            onClick={() =>
              setSelected(allSelected ? [] : members.map((m) => m.user_id))
            }
          >
            {allSelected ? "전체 해제" : "전체 선택"}
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {members.map((m) => {
            const on = selected.includes(m.user_id);
            const name = pickName(m, nameMode);
            return (
              <button
                key={m.user_id}
                type="button"
                aria-pressed={on}
                disabled={busy}
                style={memberChip(on)}
                onClick={() => toggle(m.user_id)}
              >
                <Avatar
                  userId={m.user_id}
                  name={name}
                  image={m.profile_image}
                  size="sm"
                />
                {on ? "✓ " : ""}
                {name}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={onCancel}
        >
          취소
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? "만드는 중…" : "약속 만들기"}
        </button>
      </div>
    </div>
  );
}

export default function GroupMeetingsPage() {
  const router = useRouter();
  // 로그인 확인(안 되어 있으면 /login 으로)과 그룹 멤버 목록
  const { groupId, me, group, error: groupError } = useGroupContext();
  const nameMode = useNameMode();

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [listPage, setListPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [createWhen, setCreateWhen] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false); // 작은 달력을 누르면 큰 달력 창이 열린다
  const [miniKey, setMiniKey] = useState(0); // 큰 달력을 닫을 때 작은 달력이 최신 표시를 다시 불러오게
  const createRef = useRef<HTMLElement | null>(null);

  const members = group?.members ?? [];
  const memberById = new Map(members.map((m) => [m.user_id, m]));

  const sortByTime = (list: Meeting[]) =>
    [...list].sort(
      (a, b) =>
        new Date(a.meeting_time).getTime() - new Date(b.meeting_time).getTime(),
    );

  // 확정된 약속 목록 조회
  const loadMeetings = useCallback(async () => {
    try {
      const data = await api<Meeting[]>(`/groups/${groupId}/meetings`);

      setMeetings(
        sortByTime(
          data.filter(
            (meeting) =>
              meeting.status?.toLowerCase() === "confirmed" &&
              isUpcoming(meeting.meeting_time),
          ),
        ),
      );

      setError("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }

      setError(
        err instanceof ApiError ? err.message : "약속을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, [groupId, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMeetings();
  }, [loadMeetings]);

  // 확정된 약속 삭제
  async function deleteMeeting(meetingId: number) {
    const confirmed = window.confirm(
      "확정된 약속을 삭제할까요?\n지난 기록은 그대로 남아요. (기록은 지난 기록 페이지에서 따로 지울 수 있어요)",
    );

    if (!confirmed) return;

    setError("");
    setNotice("");

    try {
      await api(`/groups/${groupId}/meetings/${meetingId}`, {
        method: "DELETE",
      });

      await loadMeetings();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "확정된 약속 삭제에 실패했습니다.",
      );
    }
  }

  // 약속 만들기 칸 열기 (달력에서 날짜를 눌러 열면 그 날짜가 미리 채워진다)
  function openCreate(day?: string) {
    setEditingId(null);
    setNotice("");
    setCreateWhen(day ? `${day}T12:00` : "");
    setCreating(true);
    setTimeout(
      () =>
        createRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      50,
    );
  }

  function closeCalendar() {
    setCalendarOpen(false);
    setMiniKey((k) => k + 1);
  }

  useEffect(() => {
    if (!calendarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCalendarOpen(false);
        setMiniKey((k) => k + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [calendarOpen]);

  async function handleCreated(created: Meeting) {
    setCreating(false);
    setNotice(`'${created.title}' 약속을 만들었어요.`);
    await loadMeetings();
  }

  function handleSaved(updated: Meeting) {
    // 날짜를 이미 지난 날로 바꾸면 이 목록에서 빠지고 지난 기록으로 넘어간다
    const moved = !isUpcoming(updated.meeting_time);
    setMeetings((cur) =>
      sortByTime(
        cur
          .map((m) => (m.id === updated.id ? updated : m))
          .filter((m) => isUpcoming(m.meeting_time)),
      ),
    );
    setEditingId(null);
    setExpandedId(null);
    setNotice(
      moved
        ? "약속을 수정했어요. 날짜가 지나서 지난 기록으로 옮겨졌어요."
        : "약속을 수정했어요. 지난 기록의 날짜·장소도 함께 바뀌었어요.",
    );
  }

  return (
    <AppShell active="meetings" dashboard>
      <div className={board.page}>
        <header className={board.hero}>
          <div>
            <p className={board.heroEyebrow}>OUR PLANS</p>
            <h1 className={board.heroTitle}>모든 약속</h1>
            <p className={board.heroSub}>
              다가오는 약속과 함께 가능한 날을 한눈에 확인해요.
            </p>
          </div>
          <button
            type="button"
            className={board.createButton}
            onClick={() => openCreate()}
          >
            + 새 약속 만들기
          </button>
        </header>

        <div className={board.columns}>
          <section className={board.panel} aria-label="다가오는 약속">
            <div className={board.panelHead}>
              <div>
                <p className={board.panelEyebrow}>UPCOMING</p>
                <h2>다가오는 약속</h2>
              </div>
              <span className={board.count}>
                {loading ? "…" : meetings.length}
              </span>
            </div>
            <div className={board.panelContent}>
              {notice && (
                <p className={board.notice} role="status">
                  {notice}
                </p>
              )}

              {creating && (
                <article className={board.formCard} ref={createRef}>
                  <MeetingCreateForm
                    key={createWhen}
                    groupId={groupId}
                    members={members}
                    nameMode={nameMode}
                    initialWhen={createWhen}
                    onCreated={(created) => void handleCreated(created)}
                    onCancel={() => setCreating(false)}
                  />
                </article>
              )}
              {groupError && <p className="error">{groupError}</p>}
              {error ? (
                <div className={board.emptyCard}>
                  <p className="error">{error}</p>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => void loadMeetings()}
                  >
                    다시 시도
                  </button>
                </div>
              ) : meetings.length === 0 ? (
                <div className={board.emptyCard}>
                  <p>
                    {loading ? "불러오는 중…" : "다가오는 약속이 아직 없어요."}
                  </p>
                  {!loading && (
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => openCreate()}
                    >
                      + 약속 만들기
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className={board.meetingList}>
                    {meetings
                      .slice(
                        (Math.min(listPage, pageCount(meetings.length)) - 1) *
                          PAGE_SIZE,
                        Math.min(listPage, pageCount(meetings.length)) *
                          PAGE_SIZE,
                      )
                      .map((meeting) => {
                        const people = (meeting.participant_ids ?? [])
                          .map((id) => memberById.get(id))
                          .filter((m): m is GroupMember => !!m);
                        const date = new Date(meeting.meeting_time);
                        const daysLeft = Math.round(
                          (new Date(
                            date.getFullYear(),
                            date.getMonth(),
                            date.getDate(),
                          ).getTime() -
                            new Date(
                              new Date().setHours(0, 0, 0, 0),
                            ).getTime()) /
                            86400000,
                        );
                        const expanded =
                          expandedId === meeting.id || editingId === meeting.id;
                        const canReadDate = !Number.isNaN(date.getTime());
                        return (
                          <article
                            key={meeting.id}
                            className={board.meetingCard}
                          >
                            <button
                              type="button"
                              className={board.meetingSummary}
                              aria-expanded={expanded}
                              aria-controls={`meeting-detail-${meeting.id}`}
                              onClick={() => {
                                if (editingId !== null) setEditingId(null);
                                setExpandedId(expanded ? null : meeting.id);
                              }}
                            >
                              <span className={board.dateTile}>
                                <span className={board.month}>
                                  {canReadDate
                                    ? [
                                        "JAN",
                                        "FEB",
                                        "MAR",
                                        "APR",
                                        "MAY",
                                        "JUN",
                                        "JUL",
                                        "AUG",
                                        "SEP",
                                        "OCT",
                                        "NOV",
                                        "DEC",
                                      ][date.getMonth()]
                                    : "—"}
                                </span>
                                <strong>
                                  {canReadDate
                                    ? String(date.getDate()).padStart(2, "0")
                                    : "—"}
                                </strong>
                              </span>
                              <span className={board.meetingInfo}>
                                <span className={board.groupBadge}>
                                  {group?.name ?? "우리 그룹"}
                                </span>
                                <strong className={board.meetingName}>
                                  {meeting.title}
                                </strong>
                                <span className={board.meetingMeta}>
                                  📍 {meeting.location || "장소 미정"} ·{" "}
                                  {canReadDate
                                    ? date.toLocaleTimeString("ko-KR", {
                                        hour: "numeric",
                                        minute: "2-digit",
                                      })
                                    : "시간 미정"}
                                </span>
                              </span>
                              <span className={board.meetingSide}>
                                <span
                                  className={board.avatars}
                                  aria-label={`참여 멤버 ${people.length}명`}
                                >
                                  {people.slice(0, 5).map((m) => (
                                    <Avatar
                                      key={m.user_id}
                                      userId={m.user_id}
                                      name={pickName(m, nameMode)}
                                      image={m.profile_image}
                                      size="sm"
                                    />
                                  ))}
                                </span>
                                <span className={board.sideBottom}>
                                  <span className={board.dDay}>
                                    {daysLeft <= 0 ? "TODAY" : `D-${daysLeft}`}
                                  </span>
                                  <span
                                    className={board.chevron}
                                    aria-hidden="true"
                                  >
                                    {expanded ? "⌄" : "›"}
                                  </span>
                                </span>
                              </span>
                            </button>
                            {expanded && (
                              <div
                                className={board.meetingDetail}
                                id={`meeting-detail-${meeting.id}`}
                              >
                                {editingId === meeting.id ? (
                                  <MeetingEditor
                                    groupId={groupId}
                                    meeting={meeting}
                                    members={members}
                                    nameMode={nameMode}
                                    onSaved={handleSaved}
                                    onCancel={() => setEditingId(null)}
                                  />
                                ) : (
                                  <>
                                    <p>
                                      <strong>날짜·시간</strong>{" "}
                                      {formatDate(meeting.meeting_time)}
                                    </p>
                                    <p>
                                      <strong>참여 인원</strong> {people.length}
                                      명
                                    </p>
                                    <div className={board.participantList}>
                                      {people.length > 0 ? (
                                        people.map((m) => (
                                          <span
                                            className={board.participant}
                                            key={m.user_id}
                                          >
                                            <Avatar
                                              userId={m.user_id}
                                              name={pickName(m, nameMode)}
                                              image={m.profile_image}
                                              size="sm"
                                            />
                                            {pickName(m, nameMode)}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="muted">
                                          참여 멤버를 아직 기록하지 않았어요.
                                        </span>
                                      )}
                                    </div>
                                    <div className={board.actions}>
                                      <button
                                        type="button"
                                        className="btn secondary sm"
                                        onClick={() => {
                                          setNotice("");
                                          setEditingId(meeting.id);
                                        }}
                                      >
                                        수정
                                      </button>
                                      <button
                                        type="button"
                                        className="btn secondary sm"
                                        onClick={() =>
                                          void deleteMeeting(meeting.id)
                                        }
                                      >
                                        삭제
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </article>
                        );
                      })}
                  </div>
                  <Pager
                    page={Math.min(listPage, pageCount(meetings.length))}
                    pages={pageCount(meetings.length)}
                    onChange={setListPage}
                  />
                </>
              )}
            </div>
          </section>

          <section className={board.panel} aria-label="함께 가능한 날">
            <div className={board.panelHead}>
              <div>
                <p className={board.panelEyebrow}>AVAILABLE</p>
                <h2>함께 가능한 날</h2>
              </div>
              <button
                type="button"
                className={board.calendarOpen}
                onClick={() => setCalendarOpen(true)}
              >
                크게 보기 →
              </button>
            </div>
            <div className={board.calendarContent}>
              <AvailabilityMini
                key={miniKey}
                groupId={groupId}
                members={members}
                meetings={meetings}
                onOpen={() => setCalendarOpen(true)}
                boardStyle
              />
            </div>
          </section>
        </div>
      </div>

      {calendarOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="함께 가능한 날 찾기"
          className={calendarCss.modalBackdrop}
          onClick={closeCalendar}
        >
          <div
            className={calendarCss.modalCard}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={calendarCss.modalHeader}>
              <div className={calendarCss.modalTitleBlock}>
                <span className={calendarCss.modalKicker}>SCHEDULE</span>
                <h2 className={calendarCss.modalTitle}>함께 가능한 날 찾기</h2>
              </div>
              <button
                type="button"
                className={calendarCss.modalClose}
                onClick={closeCalendar}
              >
                닫기 ✕
              </button>
            </div>
            <div className={calendarCss.modalBody}>
              <AvailabilityCalendar
                groupId={groupId}
                members={members}
                meId={me?.id ?? null}
                nameMode={nameMode}
                meetings={meetings}
                onCreateOnDay={(day) => {
                  closeCalendar();
                  openCreate(day);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
