"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { GroupMember } from "@/hooks/useGroupContext";
import { pickName, type NameMode } from "@/lib/nameMode";
import css from "./calendar.module.css";
import CalIcon from "@/components/CalIcon";

type Status = "available" | "unavailable";
type Row = { user_id: number; day: string; status: Status };
type View = "available" | "unavailable" | "both";
type Tool = "view" | Status | "clear";

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
  const [marks, setMarks] = useState<Record<string, Status>>({}); // `${userId}:${day}` → 상태
  const [view, setView] = useState<View>("available");
  const [tool, setTool] = useState<Tool>("view");
  const [hidden, setHidden] = useState<number[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");

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
        const next: Record<string, Status> = {};
        for (const r of rows) next[`${r.user_id}:${r.day}`] = r.status;
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
  const stat = (userId: number, day: string): Status | undefined =>
    marks[`${userId}:${day}`];

  const meetingsByDay = new Map<string, string[]>();
  for (const m of meetings) {
    const d = new Date(m.meeting_time);
    if (Number.isNaN(d.getTime())) continue;
    const k = ymd(d);
    meetingsByDay.set(k, [...(meetingsByDay.get(k) ?? []), m.title]);
  }

  // 내 상태를 바꾼다 (화면에 먼저 반영하고, 서버가 거절하면 되돌린다)
  async function apply(day: string, status: Status | "unknown") {
    if (meId == null || day < todayKey) return;
    const key = `${meId}:${day}`;
    const prev = marks[key];
    const nextStatus = prev === status ? "unknown" : status; // 같은 상태를 다시 누르면 지운다
    setMarks((cur) => {
      const n = { ...cur };
      if (nextStatus === "unknown") delete n[key];
      else n[key] = nextStatus;
      return n;
    });
    setError("");
    try {
      await api(`/groups/${groupId}/availability`, {
        method: "PUT",
        body: { days: [day], status: nextStatus },
      });
    } catch (err) {
      setMarks((cur) => {
        const n = { ...cur };
        if (prev) n[key] = prev;
        else delete n[key];
        return n;
      });
      setError(
        err instanceof ApiError
          ? err.message
          : "저장하지 못했어요. 다시 눌러 주세요.",
      );
    }
  }

  function clickDay(day: string) {
    setSelected(day);
    if (tool === "available" || tool === "unavailable") void apply(day, tool);
    else if (tool === "clear") {
      const cur = meId == null ? undefined : marks[`${meId}:${day}`];
      if (cur) void apply(day, cur); // 같은 상태를 한 번 더 보내 지운다
    }
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
  const selOff = sel
    ? members.filter((m) => stat(m.user_id, sel) === "unavailable")
    : [];
  const selNone = sel ? members.filter((m) => !stat(m.user_id, sel)) : [];
  const myStatus = sel && meId != null ? stat(meId, sel) : undefined;
  const selPast = sel != null && sel < todayKey;

  const tag = (m: GroupMember, off = false) => (
    <span key={m.user_id} className={`${css.tag} ${off ? css.tagOff : ""}`}>
      <span className={css.dot} style={{ background: colorOf(m.user_id) }} />
      {pickName(m, nameMode)}
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
                ["available", "되는 날"],
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
              : "날짜를 누르면 내 상태가 바뀌어요. 같은 상태를 다시 누르면 지워져요."}
          </span>
        </div>
      </div>

      {error && (
        <p className={css.err} role="alert">
          {error}
        </p>
      )}

      <div className={css.grid}>
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
          const allGood =
            members.length > 0 &&
            members.every((m) => stat(m.user_id, key) === "available") &&
            view !== "unavailable";
          const titles = meetingsByDay.get(key);
          const past = key < todayKey;

          const classes = [
            css.cell,
            inMonth ? "" : css.out,
            past ? css.past : "",
            key === todayKey ? css.today : "",
            key === selected ? css.selected : "",
            allGood ? css.allGood : "",
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
                  availList.map((m) => (
                    <i
                      key={`a${m.user_id}`}
                      className={css.bar}
                      style={{ background: colorOf(m.user_id) }}
                    />
                  ))}
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
                  {allGood
                    ? "모두 가능!"
                    : `${availList.length}/${shown.length}`}
                </span>
              )}
              {view === "unavailable" && offList.length > 0 && (
                <span className={`${css.count} ${css.countBad}`}>
                  {offList.length}명 불가
                </span>
              )}
              {view === "both" && allGood && (
                <span className={`${css.count} ${css.countGood}`}>
                  모두 가능!
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
              selAvail.map((m) => tag(m))
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
              <button
                type="button"
                className={`btn sm ${myStatus === "available" ? "" : "secondary"}`}
                onClick={() => void apply(sel, "available")}
              >
                되는 날
              </button>
              <button
                type="button"
                className={`btn sm ${myStatus === "unavailable" ? "" : "secondary"}`}
                onClick={() => void apply(sel, "unavailable")}
              >
                안 되는 날
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
