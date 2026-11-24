"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { GroupMember } from "@/hooks/useGroupContext";
import css from "./availabilityMini.module.css";

type Row = {
  user_id: number;
  day: string;
  status: "available" | "unavailable";
  period?: "all" | "am" | "pm";
};

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * 약속 페이지 오른쪽의 작은 달력.
 * 모두 되는 날(진한 초록)과 일부만 되는 날(연한 초록), 확정된 약속이 있는 날(점)만 한눈에 보여 주고,
 * 누르면 onOpen 으로 큰 달력을 열어 달라고 알린다.
 */
export default function AvailabilityMini({
  groupId,
  members,
  meetings,
  onOpen,
  boardStyle = false,
}: {
  groupId: number;
  members: GroupMember[];
  meetings: { id: number; meeting_time: string }[];
  onOpen: () => void;
  /** 약속 페이지 2단 카드 안에서 원래 달력을 그대로 표시 */
  boardStyle?: boolean;
}) {
  const todayKey = ymd(new Date());
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  // 날짜 → 오전 / 오후에 되는 사람 수 (종일 가능은 둘 다에 포함)
  const [availableBy, setAvailableBy] = useState<
    Record<string, { am: number; pm: number }>
  >({});

  const year = month.getFullYear();
  const monthIdx = month.getMonth();
  const startOffset = new Date(year, monthIdx, 1).getDay();
  // 실제 월에 필요한 주 수(4~6주)만 사용해 빈 마지막 주가 생기지 않도록 한다.
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const weeks = Math.ceil((startOffset + daysInMonth) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => {
    const d = new Date(year, monthIdx, 1 - startOffset + i);
    return { key: ymd(d), date: d, inMonth: d.getMonth() === monthIdx };
  });
  const rangeStart = ymd(new Date(year, monthIdx, 1 - startOffset));
  const rangeEnd = ymd(
    new Date(year, monthIdx, 1 - startOffset + weeks * 7 - 1),
  );

  // 보이는 기간의 '되는 날' 표시를 불러온다 (달을 빨리 넘기면 이전 응답은 버린다)
  useEffect(() => {
    let cancelled = false;
    api<Row[]>(
      `/groups/${groupId}/availability?start=${rangeStart}&end=${rangeEnd}`,
    )
      .then((rows) => {
        if (cancelled) return;
        const next: Record<string, { am: number; pm: number }> = {};
        for (const r of rows) {
          if (r.status !== "available") continue;
          const c = (next[r.day] ??= { am: 0, pm: 0 });
          if (r.period !== "pm") c.am += 1;
          if (r.period !== "am") c.pm += 1;
        }
        setAvailableBy(next);
      })
      .catch(() => {
        if (!cancelled) setAvailableBy({}); // 못 불러와도 작은 달력은 그대로 보인다
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, rangeStart, rangeEnd]);

  const meetingDays = new Set<string>();
  for (const m of meetings) {
    const d = new Date(m.meeting_time);
    if (!Number.isNaN(d.getTime())) meetingDays.add(ymd(d));
  }

  const total = members.length;
  const shift = (delta: number) =>
    setMonth(new Date(year, monthIdx + delta, 1));

  return (
    <div className={`${css.box}${boardStyle ? ` ${css.boardBox}` : ""}`}>
      <div className={`${css.head}${boardStyle ? ` ${css.boardHead}` : ""}`}>
        {!boardStyle && <strong className={css.title}>함께 가능한 날</strong>}
        <div className={css.nav}>
          <button type="button" onClick={() => shift(-1)} aria-label="이전 달">
            ‹
          </button>
          <span className={css.monthLabel}>
            {boardStyle
              ? `${year}년 ${monthIdx + 1}월`
              : `${year}.${pad(monthIdx + 1)}`}
          </span>
          <button type="button" onClick={() => shift(1)} aria-label="다음 달">
            ›
          </button>
        </div>
        {boardStyle && (
          <button
            type="button"
            className={css.todayButton}
            onClick={() => {
              const n = new Date();
              setMonth(new Date(n.getFullYear(), n.getMonth(), 1));
            }}
          >
            오늘
          </button>
        )}
      </div>

      <button
        type="button"
        className={css.open}
        onClick={onOpen}
        aria-label="함께 가능한 날 달력 크게 보기"
      >
        <span
          className={css.grid}
          aria-hidden
          style={
            boardStyle
              ? { gridTemplateRows: `36px repeat(${weeks}, minmax(0, 1fr))` }
              : undefined
          }
        >
          {DOW.map((d) => (
            <span key={d} className={css.dow}>
              {d}
            </span>
          ))}
          {cells.map(({ key, date, inMonth }) => {
            const c = availableBy[key];
            const n = c ? Math.max(c.am, c.pm) : 0;
            const all = total > 0 && n >= total; // 오전이나 오후 중 한 시간대에 모두 가능
            const cls = [
              css.cell,
              inMonth ? "" : css.out,
              all ? css.all : n > 0 ? css.some : "",
              key === todayKey ? css.today : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <span key={key} className={cls}>
                <span className={css.dayNumber}>{date.getDate()}</span>
                {boardStyle && inMonth && n > 0 && (
                  <small className={css.availabilityCount}>{n}명</small>
                )}
                {meetingDays.has(key) && <i className={css.dot} />}
              </span>
            );
          })}
        </span>
        <span className={css.hint}>눌러서 크게 보고 내 날짜 표시하기</span>
      </button>

      <p className={css.legend}>
        <i className={`${css.sw} ${css.all}`} /> 모두 가능
        <i className={`${css.sw} ${css.some}`} /> 일부 가능
        <i className={`${css.dot} ${css.dotLegend}`} /> 약속
      </p>
    </div>
  );
}
