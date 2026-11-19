"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { GroupMember } from "@/hooks/useGroupContext";
import { pickName, type NameMode } from "@/lib/nameMode";
import css from "./calendar.module.css";
import CalIcon from "@/components/CalIcon";

type Status = "available" | "unavailable";
type Period = "all" | "am" | "pm"; // 되는 날의 시간대: 종일 / 오전만 / 오후만
type Mark = { status: Status; period: Period };
type Row = { user_id: number; day: string; status: Status; period?: Period };
type View = "available" | "unavailable" | "both";
type Tool = "view" | "available" | "am" | "pm" | "unavailable" | "clear";

const PERIOD_LABEL: Record<Period, string> = {
  all: "종일",
  am: "오전만",
  pm: "오후만",
};

/** 도구 → 서버에 보낼 상태 */
function markOfTool(tool: Tool): Mark | null {
  if (tool === "available") return { status: "available", period: "all" };
  if (tool === "am") return { status: "available", period: "am" };
  if (tool === "pm") return { status: "available", period: "pm" };
  if (tool === "unavailable") return { status: "unavailable", period: "all" };
  return null;
}

/** 이 멤버가 오전 / 오후에 가능한가 */
const canAm = (m?: Mark) => m?.status === "available" && m.period !== "pm";
const canPm = (m?: Mark) => m?.status === "available" && m.period !== "am";

// 멤버마다 다른 색 (그룹 멤버 순서대로 배정)
const COLORS = [
  "#1FA58A",
  "#3B82F6",
  "#F59E0B",
  "#8B5CF6",
  "#EC4899",
  "#F97316",
  "#84CC16",
  "#64748B",
];
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** 두 날짜 사이(양 끝 포함)의 모든 날짜 */
function daysBetween(a: string, b: string): string[] {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const out: string[] = [];
  const d = parseDay(from);
  for (let i = 0; i < 62 && ymd(d) <= to; i += 1) {
    out.push(ymd(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function dayLabel(day: string) {
  const d = parseDay(day);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`;
}

export default function AvailabilityCalendar({
  groupId,
  members,
  meId,
  nameMode,
  meetings,
  onCreateOnDay,
}: {
  groupId: number;
  members: GroupMember[];
  meId: number | null;
  nameMode: NameMode;
  meetings: { id: number; title: string; meeting_time: string }[];
  onCreateOnDay: (day: string) => void;
}) {
  const todayKey = ymd(new Date());
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [marks, setMarks] = useState<Record<string, Mark>>({}); // `${userId}:${day}` → 상태
  const [view, setView] = useState<View>("available");
  const [tool, setTool] = useState<Tool>("view");
  const [hidden, setHidden] = useState<number[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  // 끌어서 여러 날짜를 한 번에 표시하는 중인 범위
  const dragRef = useRef<{ start: string; cur: string } | null>(null);
  const suppressClick = useRef(false);
  const [dragDays, setDragDays] = useState<string[]>([]);

  // 이번 달 칸 42개 (앞뒤 달 일부 포함)
  const year = month.getFullYear();
  const monthIdx = month.getMonth();
  const startOffset = new Date(year, monthIdx, 1).getDay();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(year, monthIdx, 1 - startOffset + i);
    return { key: ymd(d), date: d, inMonth: d.getMonth() === monthIdx };
  });
  const rangeStart = ymd(new Date(year, monthIdx, 1 - startOffset));
  const rangeEnd = ymd(new Date(year, monthIdx, 1 - startOffset + 41));

  // 보이는 기간의 표시를 불러온다 (달을 빨리 넘기면 이전 응답은 버린다)
  useEffect(() => {
    let cancelled = false;
    api<Row[]>(
      `/groups/${groupId}/availability?start=${rangeStart}&end=${rangeEnd}`,
    )
      .then((rows) => {
        if (cancelled) return;
        const next: Record<string, Mark> = {};
        for (const r of rows)
          next[`${r.user_id}:${r.day}`] = {
            status: r.status,
            period: r.period ?? "all",
          };
        setMarks(next);
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "달력을 불러오지 못했어요.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, rangeStart, rangeEnd]);

  const colorOf = (userId: number) => {
    const idx = members.findIndex((m) => m.user_id === userId);
    return COLORS[(idx < 0 ? 0 : idx) % COLORS.length];
  };
  const shown = members.filter((m) => !hidden.includes(m.user_id));
  const mark = (userId: number, day: string): Mark | undefined =>
    marks[`${userId}:${day}`];
  const stat = (userId: number, day: string): Status | undefined =>
    mark(userId, day)?.status;

  const meetingsByDay = new Map<string, string[]>();
  for (const m of meetings) {
    const d = new Date(m.meeting_time);
    if (Number.isNaN(d.getTime())) continue;
    const k = ymd(d);
    meetingsByDay.set(k, [...(meetingsByDay.get(k) ?? []), m.title]);
  }

  // 내 상태를 바꾼다: 여러 날짜를 한 번에 (화면에 먼저 반영하고, 서버가 거절하면 되돌린다)
  async function applyMany(days: string[], next: Mark | null) {
    const target = days.filter((d) => d >= todayKey);
    if (meId == null || target.length === 0) return;
    const prevs = target.map((d) => marks[`${meId}:${d}`]);
    setMarks((cur) => {
      const n = { ...cur };
      for (const d of target) {
        if (next) n[`${meId}:${d}`] = next;
        else delete n[`${meId}:${d}`];
      }
      return n;
    });
    setError("");
    try {
      await api(`/groups/${groupId}/availability`, {
        method: "PUT",
        body: {
          days: target,
          status: next ? next.status : "unknown",
          period: next ? next.period : "all",
        },
      });
    } catch (err) {
      setMarks((cur) => {
        const n = { ...cur };
        target.forEach((d, i) => {
          if (prevs[i]) n[`${meId}:${d}`] = prevs[i]!;
          else delete n[`${meId}:${d}`];
        });
        return n;
      });
      setError(
        err instanceof ApiError
          ? err.message
          : "저장하지 못했어요. 다시 눌러 주세요.",
      );
    }
  }

  // 한 날짜: 같은 상태를 다시 누르면 지운다
  function applyOne(day: string, next: Mark | null) {
    const cur = meId == null ? undefined : marks[`${meId}:${day}`];
    const same =
      cur && next && cur.status === next.status && cur.period === next.period;
    void applyMany([day], same ? null : next);
  }

  function clickDay(day: string) {
    if (suppressClick.current) {
      suppressClick.current = false; // 끌어서 이미 처리한 뒤에 따라오는 클릭은 무시
      return;
    }
    setSelected(day);
    if (tool === "clear") {
      if (meId != null && marks[`${meId}:${day}`]) void applyMany([day], null);
    } else {
      const next = markOfTool(tool);
      if (next) applyOne(day, next);
    }
  }

  // 끌어서 선택: 도구를 고른 상태에서 날짜 위를 쓸어 지나가면 그 기간을 한꺼번에 표시한다
  const painting = tool !== "view" && meId != null;
  const dayAt = (e: React.PointerEvent) =>
    (
      document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    )?.closest<HTMLElement>("[data-day]")?.dataset.day;

  function onGridDown(e: React.PointerEvent) {
    if (!painting) return;
    const day = (e.target as HTMLElement).closest<HTMLElement>("[data-day]")
      ?.dataset.day;
    if (!day || day < todayKey) return;
    dragRef.current = { start: day, cur: day };
    setDragDays([day]);
  }
  function onGridMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const day = dayAt(e);
    if (!day || day === d.cur) return;
    d.cur = day;
    setDragDays(daysBetween(d.start, day));
  }
  function onGridUp() {
    const d = dragRef.current;
    dragRef.current = null;
    const days = dragDays;
    setDragDays([]);
    if (!d || d.start === d.cur) return; // 한 칸만 눌렀으면 일반 클릭으로 처리
    suppressClick.current = true;
    window.setTimeout(() => (suppressClick.current = false), 80); // 따라오는 클릭만 무시하고 곧 풀어 준다
    setSelected(d.cur);
    void applyMany(days, tool === "clear" ? null : markOfTool(tool));
  }
  function onGridCancel() {
    dragRef.current = null;
    setDragDays([]);
  }

  function toggleWho(userId: number) {
    setHidden((cur) =>
      cur.includes(userId)
        ? cur.filter((id) => id !== userId)
        : [...cur, userId],
    );
  }

  const moveMonth = (delta: number) =>
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  const sel = selected;
  const selAvail = sel
    ? members.filter((m) => stat(m.user_id, sel) === "available")
    : [];
  const periodNote = (m: GroupMember) => {
    const p = sel ? mark(m.user_id, sel)?.period : undefined;
    return p && p !== "all" ? ` (${PERIOD_LABEL[p]})` : "";
  };
  const selOff = sel
    ? members.filter((m) => stat(m.user_id, sel) === "unavailable")
    : [];
  const selNone = sel ? members.filter((m) => !stat(m.user_id, sel)) : [];
  const myMark = sel && meId != null ? mark(meId, sel) : undefined;
  const selPast = sel != null && sel < todayKey;

  const tag = (m: GroupMember, off = false, note = "") => (
    <span key={m.user_id} className={`${css.tag} ${off ? css.tagOff : ""}`}>
      <span className={css.dot} style={{ background: colorOf(m.user_id) }} />
      {pickName(m, nameMode)}
      {note}
    </span>
  );

  return (
    <div className={css.wrap}>
      <div className={css.head}>
        <div className={css.month}>
          <button
            type="button"
            className={css.nav}
            onClick={() => moveMonth(-1)}
            aria-label="이전 달"
          >
            ‹
          </button>
          <span className={css.monthLabel}>
            {month.getFullYear()}년 {month.getMonth() + 1}월
          </span>
          <button
            type="button"
            className={css.nav}
            onClick={() => moveMonth(1)}
            aria-label="다음 달"
          >
            ›
          </button>
          <button
            type="button"
            className="btn secondary sm"
            onClick={() =>
              setMonth(
                new Date(new Date().getFullYear(), new Date().getMonth(), 1),
              )
            }
          >
            오늘
          </button>
        </div>

        <div className={css.seg} role="group" aria-label="보기 방식">
          {(
            [
              ["available", "되는 날"],
              ["unavailable", "안 되는 날"],
              ["both", "둘 다"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              className={`${css.segBtn} ${view === v ? css.segOn : ""}`}
              onClick={() => setView(v)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 멤버별 색: 누르면 그 멤버를 숨기거나 다시 보여 준다 */}
      <div>
        <p className={css.rowLabel}>멤버별 색 (눌러서 보기/숨기기)</p>
        <div className={css.legend}>
          {members.map((m) => (
            <button
              key={m.user_id}
              type="button"
              aria-pressed={!hidden.includes(m.user_id)}
              className={`${css.who} ${hidden.includes(m.user_id) ? css.whoOff : ""}`}
              onClick={() => toggleWho(m.user_id)}
            >
              <span
                className={css.dot}
                style={{ background: colorOf(m.user_id) }}
              />
              {pickName(m, nameMode)}
              {m.user_id === meId ? " (나)" : ""}
            </button>
          ))}
        </div>
      </div>

      {/* 내 날짜 표시 도구 */}
      <div>
        <p className={css.rowLabel}>내 날짜 표시</p>
        <div className={css.tools}>
          <div className={css.seg} role="group" aria-label="내 날짜 표시 방식">
            {(
              [
                ["view", "보기만"],
                ["available", "종일 되는 날"],
                ["am", "오전만"],
                ["pm", "오후만"],
                ["unavailable", "안 되는 날"],
                ["clear", "지우개"],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                type="button"
                disabled={meId == null}
                aria-pressed={tool === t}
                className={`${css.segBtn} ${tool === t ? css.segOn : ""}`}
                onClick={() => setTool(t)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className={css.toolHint}>
            {tool === "view"
              ? "날짜를 누르면 그날 멤버별 상태를 볼 수 있어요."
              : "날짜를 누르거나, 끌어서 여러 날을 한 번에 표시해요. 같은 상태를 다시 누르면 지워져요."}
          </span>
        </div>
      </div>

      {error && (
        <p className={css.err} role="alert">
          {error}
        </p>
      )}

      <div
        className={`${css.grid} ${painting ? css.painting : ""}`}
        onPointerDown={onGridDown}
        onPointerMove={onGridMove}
        onPointerUp={onGridUp}
        onPointerCancel={onGridCancel}
      >
        {DOW.map((d, i) => (
          <div
            key={d}
            className={`${css.dow} ${i === 0 ? css.sun : ""} ${i === 6 ? css.sat : ""}`}
          >
            {d}
          </div>
        ))}

        {cells.map(({ key, date, inMonth }) => {
          const availList = shown.filter(
            (m) => stat(m.user_id, key) === "available",
          );
          const offList = shown.filter(
            (m) => stat(m.user_id, key) === "unavailable",
          );
          // 오전 / 오후에 전원이 가능한지 (종일 가능은 둘 다에 포함)
          const amAll =
            members.length > 0 &&
            members.every((m) => canAm(mark(m.user_id, key)));
          const pmAll =
            members.length > 0 &&
            members.every((m) => canPm(mark(m.user_id, key)));
          const allGood = (amAll || pmAll) && view !== "unavailable";
          const goodLabel =
            amAll && pmAll
              ? "모두 가능!"
              : amAll
                ? "오전 모두 가능"
                : "오후 모두 가능";
          // 한 명이라도 안 되면 그 날은 흐리게 (되는 날 보기 / 둘 다 보기에서)
          const blocked =
            view !== "unavailable" && offList.length > 0 && !allGood;
          const titles = meetingsByDay.get(key);
          const past = key < todayKey;

          const classes = [
            css.cell,
            inMonth ? "" : css.out,
            past ? css.past : "",
            key === todayKey ? css.today : "",
            key === selected ? css.selected : "",
            allGood ? css.allGood : "",
            blocked ? css.blocked : "",
            dragDays.includes(key) ? css.inDrag : "",
          ]
            .filter(Boolean)
            .join(" ");

          const summary = `${date.getMonth() + 1}월 ${date.getDate()}일, 되는 사람 ${
            members.filter((m) => stat(m.user_id, key) === "available").length
          }명, 안 되는 사람 ${members.filter((m) => stat(m.user_id, key) === "unavailable").length}명${
            titles ? `, 약속 ${titles.join(", ")}` : ""
          }`;

          return (
            <button
              key={key}
              type="button"
              className={classes}
              data-day={key}
              onClick={() => clickDay(key)}
              aria-label={summary}
              title={summary}
            >
              <span className={css.num}>
                <span>{date.getDate()}</span>
                {titles && (
                  <span className={css.meet} aria-hidden>
                    <CalIcon />
                  </span>
                )}
              </span>

              <span className={css.bars}>
                {view !== "unavailable" &&
                  availList.map((m) => {
                    const p = mark(m.user_id, key)?.period ?? "all";
                    return (
                      <i
                        key={`a${m.user_id}`}
                        className={`${css.bar} ${p === "am" ? css.barAm : p === "pm" ? css.barPm : ""}`}
                        style={{ ["--c" as string]: colorOf(m.user_id) }}
                        title={p === "all" ? undefined : PERIOD_LABEL[p]}
                      />
                    );
                  })}
                {view !== "available" &&
                  offList.map((m) => (
                    <i
                      key={`o${m.user_id}`}
                      className={`${css.bar} ${css.barOff}`}
                      style={{ ["--c" as string]: colorOf(m.user_id) }}
                    />
                  ))}
              </span>

              {view === "available" && availList.length > 0 && (
                <span
                  className={`${css.count} ${allGood ? css.countGood : ""}`}
                >
                  {allGood ? goodLabel : `${availList.length}/${shown.length}`}
                </span>
              )}
              {view === "unavailable" && offList.length > 0 && (
                <span className={`${css.count} ${css.countBad}`}>
                  {offList.length}명 불가
                </span>
              )}
              {view === "both" && allGood && (
                <span className={`${css.count} ${css.countGood}`}>
                  {goodLabel}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 선택한 날짜 자세히 */}
      {sel && (
        <div className={css.panel}>
          <div className={css.panelHead}>
            <span className={css.panelTitle}>{dayLabel(sel)}</span>
            {!selPast && (
              <button
                type="button"
                className="btn sm"
                onClick={() => onCreateOnDay(sel)}
              >
                이 날짜로 약속 만들기
              </button>
            )}
          </div>

          {meetingsByDay.get(sel) && (
            <p className="muted">
              <CalIcon /> 확정된 약속: {meetingsByDay.get(sel)!.join(", ")}
            </p>
          )}

          <div className={css.group}>
            <span className={css.groupLabel}>되는 사람</span>
            {selAvail.length ? (
              selAvail.map((m) => tag(m, false, periodNote(m)))
            ) : (
              <span className="muted">없음</span>
            )}
          </div>
          <div className={css.group}>
            <span className={css.groupLabel}>안 되는 사람</span>
            {selOff.length ? (
              selOff.map((m) => tag(m))
            ) : (
              <span className="muted">없음</span>
            )}
          </div>
          <div className={css.group}>
            <span className={css.groupLabel}>아직 몰라요</span>
            {selNone.length ? (
              selNone.map((m) => tag(m, true))
            ) : (
              <span className="muted">없음</span>
            )}
          </div>

          {!selPast && meId != null && (
            <div className={css.mine}>
              <span className={css.groupLabel}>내 상태</span>
              {(
                [
                  ["available", "all", "종일 되는 날"],
                  ["available", "am", "오전만"],
                  ["available", "pm", "오후만"],
                  ["unavailable", "all", "안 되는 날"],
                ] as const
              ).map(([st, pd, label]) => {
                const on = myMark?.status === st && myMark.period === pd;
                return (
                  <button
                    key={label}
                    type="button"
                    className={`btn sm ${on ? "" : "secondary"}`}
                    onClick={() => applyOne(sel, { status: st, period: pd })}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
