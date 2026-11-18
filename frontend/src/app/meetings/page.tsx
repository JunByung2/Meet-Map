"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import AppShell from "@/components/AppShell";
import Pager, { PAGE_SIZE, pageCount } from "@/components/Pager";
import { colorMap } from "@/lib/memories";
import "@/components/memories.css";

type Group = { id: number; name: string; icon: string | null };
type Meeting = {
  id: number;
  group_id: number;
  title: string;
  location: string;
  meeting_time: string;
  status: string;
};

const fmt = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
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

  const pastPages = pageCount(past.length);
  const safePage = Math.min(pastPage, pastPages);
  const upPages = pageCount(upcoming.length);
  const safeUp = Math.min(upPage, upPages);

  const row = (m: Meeting) => (
    <Link
      key={`${m.group_id}-${m.id}`}
      href={`/groups/${m.group_id}/meetings`}
      className="card"
      style={{
        color: "inherit",
        textDecoration: "none",
        borderLeft: `5px solid ${colors.get(m.group_id) ?? "var(--line)"}`,
      }}
    >
      <div className="row-between">
        <div>
          <p className="card-title">{m.title}</p>
          <p className="muted" style={{ marginTop: 2 }}>
            {fmt.format(new Date(m.meeting_time))} · {nameOf(m.group_id)}
            {m.location ? ` · ${m.location}` : ""}
          </p>
        </div>
        <span className="link-arrow">→</span>
      </div>
    </Link>
  );

  return (
    <AppShell>
      <div className="page-head">
        <div>
          <p className="eyebrow">내 모든 그룹</p>
          <h1 className="page-title">약속</h1>
          <p className="page-sub">
            내가 속한 모든 그룹의 확정된 약속을 모아 봐요. 누르면 그 그룹의 약속
            화면으로 이동해요.
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
            <div className="am-groups">
              <button
                type="button"
                className={groupId === null ? "on" : ""}
                onClick={() => {
                  setGroupId(null);
                  setPastPage(1);
                  setUpPage(1);
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
                    setPastPage(1);
                    setUpPage(1);
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

          <h2 className="section-title" style={{ marginBottom: 12 }}>
            다가오는 약속
          </h2>
          {upcoming.length === 0 ? (
            <div className="card muted">앞으로 예정된 약속이 없어요.</div>
          ) : (
            <>
              <div className="stack">
                {upcoming
                  .slice((safeUp - 1) * PAGE_SIZE, safeUp * PAGE_SIZE)
                  .map(row)}
              </div>
              <Pager page={safeUp} pages={upPages} onChange={setUpPage} />
            </>
          )}

          {past.length > 0 && (
            <>
              <h2 className="section-title" style={{ margin: "28px 0 12px" }}>
                지난 약속
              </h2>
              <div className="stack">
                {past
                  .slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
                  .map(row)}
              </div>
              <Pager page={safePage} pages={pastPages} onChange={setPastPage} />
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
