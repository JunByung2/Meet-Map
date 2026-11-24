"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import AppShell from "@/components/AppShell";
import Pager, { pageCount } from "@/components/Pager";
import Panel from "@/components/Panel";
import { colorMap } from "@/lib/memories";
import "@/components/memories.css";
import "./meetings-page.css";

type Group = { id: number; name: string; icon: string | null };
type Meeting = {
  id: number;
  group_id: number;
  title: string;
  location: string;
  meeting_time: string;
  status: string;
};

const SIZE = 4;
const MONTHS = [
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
];
const timeFmt = new Intl.DateTimeFormat("ko-KR", {
  hour: "numeric",
  minute: "2-digit",
});

/** 그룹을 열지 않아도 내가 속한 모든 그룹의 확정된 약속을 목록으로 본다 (달력은 그룹 홈에 있다) */
export default function AllMeetingsPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [error, setError] = useState("");
  const [groupId, setGroupId] = useState<number | null>(null);
  const [pastPage, setPastPage] = useState(1);
  const [upPage, setUpPage] = useState(1);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    // 그룹마다 따로 부르지 않고 한 번에 가져온다
    api<{ groups: Group[]; meetings: Meeting[] }>("/me/meetings")
      .then((d) => {
        if (cancelled) return;
        setMeetings(d.meetings);
        setGroups(d.groups);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setError(
          err instanceof ApiError ? err.message : "오류가 발생했습니다.",
        );
        setGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const colors = useMemo(() => colorMap(groups ?? []), [groups]);
  const nameOf = (id: number) => groups?.find((g) => g.id === id)?.name ?? "";

  const { upcoming, past } = useMemo(() => {
    const list = meetings
      .filter((m) => m.status?.toLowerCase() === "confirmed")
      .filter((m) => groupId === null || m.group_id === groupId)
      .filter((m) => !Number.isNaN(new Date(m.meeting_time).getTime()))
      .sort(
        (a, b) =>
          new Date(a.meeting_time).getTime() -
          new Date(b.meeting_time).getTime(),
      );
    return {
      upcoming: list.filter((m) => new Date(m.meeting_time).getTime() >= now),
      past: list
        .filter((m) => new Date(m.meeting_time).getTime() < now)
        .reverse(),
    };
  }, [meetings, groupId, now]);

  const pastPages = pageCount(past.length, SIZE);
  const safePage = Math.min(pastPage, pastPages);
  const upPages = pageCount(upcoming.length, SIZE);
  const safeUp = Math.min(upPage, upPages);

  const dday = (m: Meeting) => {
    const t = new Date(m.meeting_time);
    const a = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
    const n = new Date(now);
    const b = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    const d = Math.round((a - b) / 86400000);
    return d === 0 ? "D-DAY" : `D-${d}`;
  };

  const row = (m: Meeting, isUp: boolean) => {
    const t = new Date(m.meeting_time);
    return (
      <Link
        key={`${m.group_id}-${m.id}`}
        href={`/groups/${m.group_id}/meetings`}
        className="mp-card"
      >
        <div className="mp-date">
          <small>{MONTHS[t.getMonth()]}</small>
          <strong>{String(t.getDate()).padStart(2, "0")}</strong>
        </div>
        <div className="mp-info">
          <span className="mp-tag">
            <i
              className="gdot"
              style={{ ["--c" as string]: colors.get(m.group_id) }}
            />
            {nameOf(m.group_id)}
          </span>
          <span className="mp-name">{m.title}</span>
          <span className="mp-meta">
            {t.getFullYear()}.{t.getMonth() + 1}.{t.getDate()} ·{" "}
            {timeFmt.format(t)}
            {m.location ? ` · ${m.location}` : ""}
          </span>
        </div>
        <div className="mp-side">
          {isUp && <span className="mp-dday">{dday(m)}</span>}
          <span>›</span>
        </div>
      </Link>
    );
  };

  const resetPages = () => {
    setPastPage(1);
    setUpPage(1);
  };

  return (
    <AppShell>
      <div className="page-head mp-head">
        <div>
          <p className="eyebrow">내 모든 그룹</p>
          <p className="page-sub">
            내가 속한 모든 그룹의 확정된 약속을 모아 봐요.
          </p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {groups === null ? (
        <div className="card muted">불러오는 중...</div>
      ) : groups.length === 0 ? (
        <div className="card">
          <p className="card-title">아직 그룹이 없어요</p>
          <p className="muted" style={{ marginTop: 6 }}>
            그룹을 만들거나 초대 링크로 들어오면 약속이 여기에 모여요.
          </p>
        </div>
      ) : (
        <>
          {groups.length > 1 && (
            <div className="am-groups mp-chips">
              <button
                type="button"
                className={groupId === null ? "on" : ""}
                onClick={() => {
                  setGroupId(null);
                  resetPages();
                }}
              >
                전체
              </button>
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={groupId === g.id ? "on tint" : ""}
                  style={{ ["--c" as string]: colors.get(g.id) }}
                  onClick={() => {
                    setGroupId(g.id);
                    resetPages();
                  }}
                >
                  <i
                    className="gdot"
                    style={{ ["--c" as string]: colors.get(g.id) }}
                  />
                  {g.name}
                </button>
              ))}
            </div>
          )}

          <div className="mp-cols">
            <Panel
              title="다가오는 약속"
              kicker="UPCOMING"
              action={<span className="mp-count">{upcoming.length}</span>}
            >
              {upcoming.length === 0 ? (
                <p className="mp-empty">앞으로 예정된 약속이 없어요.</p>
              ) : (
                <>
                  <div className="mp-body">
                    {upcoming
                      .slice((safeUp - 1) * SIZE, safeUp * SIZE)
                      .map((m) => row(m, true))}
                  </div>
                  <Pager page={safeUp} pages={upPages} onChange={setUpPage} />
                </>
              )}
            </Panel>
            <Panel
              title="지난 약속"
              kicker="PAST MEETINGS"
              action={<span className="mp-count">{past.length}</span>}
            >
              {past.length === 0 ? (
                <p className="mp-empty">지난 약속이 아직 없어요.</p>
              ) : (
                <>
                  <div className="mp-body">
                    {past
                      .slice((safePage - 1) * SIZE, safePage * SIZE)
                      .map((m) => row(m, false))}
                  </div>
                  <Pager
                    page={safePage}
                    pages={pastPages}
                    onChange={setPastPage}
                  />
                </>
              )}
            </Panel>
          </div>
        </>
      )}
    </AppShell>
  );
}
