"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { GroupMember } from "@/hooks/useGroupContext";
import css from "./availabilityMini.module.css";

type Row = {
  user_id: number;
  day: string;
  status: "available" | "unavailable";
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
}: {
  groupId: number;
  members: GroupMember[];
  meetings: { id: number; meeting_time: string }[];
  onOpen: () => void;
}) {
  const todayKey = ymd(new Date());
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [availableBy, setAvailableBy] = useState<Record<string, number[]>>({});

  const year = month.getFullYear();
  const monthIdx = month.getMonth();
  const startOffset = new Date(year, monthIdx, 1).getDay();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(year, monthIdx, 1 - startOffset + i);
    return { key: ymd(d), date: d, inMonth: d.getMonth() === monthIdx };
  });
  const rangeStart = ymd(new Date(year, monthIdx, 1 - startOffset));
  const rangeEnd = ymd(new Date(year, monthIdx, 1 - startOffset + 41));

  // 보이는 기간의 '되는 날' 표시를 불러온다 (달을 빨리 넘기면 이전 응답은 버린다)
  useEffect(() => {
    let cancelled = false;
    api<Row[]>(
      `/groups/${groupId}/availability?start=${rangeStart}&end=${rangeEnd}`,
    )
      .then((rows) => {
        if (cancelled) return;
        const next: Record<string, number[]> = {};
        for (const r of rows) {
          if (r.status !== "available") continue;
          next[r.day] = [...(next[r.day] ?? []), r.user_id];
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
    <div className={css.box}>
      <div className={css.head}>
        <strong className={css.title}>함께 가능한 날</strong>
        <div className={css.nav}>
          <button type="button" onClick={() => shift(-1)} aria-label="이전 달">
            ‹
          </button>
          <span>
            {year}.{pad(monthIdx + 1)}
          </span>
          <button type="button" onClick={() => shift(1)} aria-label="다음 달">
            ›
          </button>
        </div>
      </div>

      <button
        type="button"
        className={css.open}
        onClick={onOpen}
        aria-label="함께 가능한 날 달력 크게 보기"
      >
        <span className={css.grid} aria-hidden>
          {DOW.map((d) => (
            <span key={d} className={css.dow}>
              {d}
            </span>
          ))}
          {cells.map(({ key, date, inMonth }) => {
            const n = availableBy[key]?.length ?? 0;
            const all = total > 0 && n >= total;
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
                {date.getDate()}
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
