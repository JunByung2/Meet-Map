"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import css from "./groupsCalendar.module.css";

type GroupLite = { id: number; name: string; icon: string | null };

type MeetingLite = {
  id: number;
  group_id: number;
  title: string;
  location: string;
  meeting_time: string;
  status: string;
};

// 그룹마다 다른 색 (내 그룹 순서대로 배정, 넘치면 처음부터 다시)
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
const MAX_CHIPS = 2; // 칸 하나에 제목을 보여 줄 최대 개수 (나머지는 +N)

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

function timeLabel(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 메인 페이지 달력: 내가 속한 모든 그룹의 약속을 한 달력에 모아 보여 준다.
 * 그룹마다 색이 달라서 어느 그룹 약속인지 바로 알 수 있다.
 */
export default function GroupsMeetingCalendar({
  groups,
  meetings: given,
}: {
  groups: GroupLite[];
  /** 이미 불러온 약속이 있으면 넘겨 준다 (그러면 다시 불러오지 않는다) */
  meetings?: MeetingLite[];
}) {
  const todayKey = ymd(new Date());
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [fetched, setFetched] = useState<MeetingLite[]>([]);
  const [loadingOwn, setLoadingOwn] = useState(true);
  const [failed, setFailed] = useState(0); // 불러오지 못한 그룹 수
  const [hidden, setHidden] = useState<number[]>([]); // 숨긴 그룹
  const [selected, setSelected] = useState<string | null>(null); // null 이면 다가오는 약속을 보여 준다

  // 그룹 목록이 바뀔 때만 다시 불러온다 (그룹마다 약속 목록을 한 번씩 조회)
  const groupKey = groups.map((g) => g.id).join(",");
  const meetings = given ?? fetched;
  const loading = given ? false : loadingOwn;
  useEffect(() => {
    if (given) return;
    let cancelled = false;
    Promise.allSettled(
      groups.map((g) => api<MeetingLite[]>(`/groups/${g.id}/meetings`)),
    ).then((results) => {
      if (cancelled) return;
      const all: MeetingLite[] = [];
      let bad = 0;
      for (const r of results) {
        if (r.status === "fulfilled") all.push(...r.value);
        else bad += 1;
      }
      setFetched(all);
      setFailed(bad);
      setLoadingOwn(false);
    });
    return () => {
      cancelled = true;
    };
    // groups 배열 자체는 매 렌더 새로 만들어질 수 있어서 id 목록으로 비교한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey, given]);

  const colorOf = (groupId: number) => {
    const idx = groups.findIndex((g) => g.id === groupId);
    return COLORS[(idx < 0 ? 0 : idx) % COLORS.length];
  };
  const nameOf = (groupId: number) =>
    groups.find((g) => g.id === groupId)?.name ?? "";

  // 날짜별로 묶기 (확정된 약속만, 숨긴 그룹 제외)
  const byDay = useMemo(() => {
    const map = new Map<string, MeetingLite[]>();
    for (const m of meetings) {
      if (m.status?.toLowerCase() !== "confirmed") continue;
      if (hidden.includes(m.group_id)) continue;
      const d = new Date(m.meeting_time);
      if (Number.isNaN(d.getTime())) continue;
      const k = ymd(d);
      map.set(k, [...(map.get(k) ?? []), m]);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(a.meeting_time).getTime() -
          new Date(b.meeting_time).getTime(),
      );
    }
    return map;
  }, [meetings, hidden]);

  // 이번 달 칸 42개 (앞뒤 달 일부 포함)
  const year = month.getFullYear();
  const monthIdx = month.getMonth();
  const startOffset = new Date(year, monthIdx, 1).getDay();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(year, monthIdx, 1 - startOffset + i);
    return { key: ymd(d), date: d, inMonth: d.getMonth() === monthIdx };
  });

  const shift = (delta: number) =>
    setMonth(new Date(year, monthIdx + delta, 1));
  const goToday = () => {
    const n = new Date();
    setMonth(new Date(n.getFullYear(), n.getMonth(), 1));
    setSelected(null);
  };

  const selList = selected ? (byDay.get(selected) ?? []) : [];

  // 오늘 이후 약속 중 가까운 5개
  const upcoming = useMemo(() => {
    const list: MeetingLite[] = [];
    for (const [k, items] of byDay) if (k >= todayKey) list.push(...items);
    list.sort(
      (a, b) =>
        new Date(a.meeting_time).getTime() - new Date(b.meeting_time).getTime(),
    );
    return list.slice(0, 5);
  }, [byDay, todayKey]);

  const item = (m: MeetingLite, withDate: boolean) => (
    <Link
      key={m.id}
      href={`/groups/${m.group_id}/meetings`}
      className={css.item}
      style={{ ["--c" as string]: colorOf(m.group_id) }}
    >
      <span className={css.itemBar} />
      <span className={css.itemBody}>
        <strong>{m.title}</strong>
        <span className="muted">
          {withDate ? `${dayLabel(ymd(new Date(m.meeting_time)))} ` : ""}
          {timeLabel(m.meeting_time)} · {nameOf(m.group_id)}
          {m.location ? ` · 📍 ${m.location}` : ""}
        </span>
      </span>
      <span className="link-arrow">→</span>
    </Link>
  );

  return (
    <div className={css.wrap}>
      <div className={css.head}>
        <div className={css.month}>
          <button
            type="button"
            className={css.nav}
            onClick={() => shift(-1)}
            aria-label="이전 달"
          >
            ‹
          </button>
          <span className={css.monthLabel}>
            {year}년 {monthIdx + 1}월
          </span>
          <button
            type="button"
            className={css.nav}
            onClick={() => shift(1)}
            aria-label="다음 달"
          >
            ›
          </button>
        </div>
        <button type="button" className="btn secondary sm" onClick={goToday}>
          오늘
        </button>
      </div>

      {/* 그룹 색 범례: 누르면 그 그룹 약속을 숨기거나 다시 보인다 */}
      {groups.length > 1 && (
        <div className={css.legend}>
          {groups.map((g) => {
            const off = hidden.includes(g.id);
            return (
              <button
                key={g.id}
                type="button"
                className={`${css.who} ${off ? css.whoOff : ""}`}
                aria-pressed={!off}
                onClick={() =>
                  setHidden((cur) =>
                    cur.includes(g.id)
                      ? cur.filter((x) => x !== g.id)
                      : [...cur, g.id],
                  )
                }
              >
                <i className={css.dot} style={{ background: colorOf(g.id) }} />
                {g.name}
              </button>
            );
          })}
        </div>
      )}

      {failed > 0 && (
        <p className="muted" role="status">
          그룹 {failed}곳의 약속은 불러오지 못했어요. 새로고침해 보세요.
        </p>
      )}

      <div className={css.body}>
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
            const list = byDay.get(key) ?? [];
            const classes = [
              css.cell,
              inMonth ? "" : css.out,
              key === todayKey ? css.today : "",
              key === selected ? css.selected : "",
            ]
              .filter(Boolean)
              .join(" ");
            const summary = `${date.getMonth() + 1}월 ${date.getDate()}일${
              list.length
                ? `, 약속 ${list.map((m) => `${nameOf(m.group_id)} ${m.title}`).join(", ")}`
                : ", 약속 없음"
            }`;

            return (
              <button
                key={key}
                type="button"
                className={classes}
                onClick={() => setSelected(key)}
                aria-label={summary}
                title={summary}
              >
                <span className={css.num}>{date.getDate()}</span>
                {list.slice(0, MAX_CHIPS).map((m) => (
                  <span
                    key={m.id}
                    className={css.chip}
                    style={{ ["--c" as string]: colorOf(m.group_id) }}
                  >
                    {m.title}
                  </span>
                ))}
                {list.length > MAX_CHIPS && (
                  <span className={css.more}>+{list.length - MAX_CHIPS}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* 옆 패널: 날짜를 고르면 그날 약속, 아니면 다가오는 약속 */}
        <div className={css.panel}>
          {selected ? (
            <>
              <div className={css.panelHead}>
                <span className={css.panelTitle}>{dayLabel(selected)}</span>
                <button
                  type="button"
                  className="btn secondary sm"
                  onClick={() => setSelected(null)}
                >
                  다가오는 약속 보기
                </button>
              </div>
              {loading ? (
                <span className="muted">불러오는 중…</span>
              ) : selList.length === 0 ? (
                <span className="muted">이 날은 약속이 없어요.</span>
              ) : (
                selList.map((m) => item(m, false))
              )}
            </>
          ) : (
            <>
              <span className={css.panelTitle}>다가오는 약속</span>
              {loading ? (
                <span className="muted">불러오는 중…</span>
              ) : upcoming.length === 0 ? (
                <span className="muted">앞으로 예정된 약속이 없어요.</span>
              ) : (
                upcoming.map((m) => item(m, true))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
