"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import AppShell from "@/components/AppShell";
import { LAST_GROUP_KEY } from "@/components/Sidebar";
import { ddayLabel } from "@/lib/dday";
import { pickName, readNameMode } from "@/lib/nameMode";
import Avatar from "@/components/Avatar";
import GroupsMeetingCalendar from "@/features/calendar/GroupsMeetingCalendar";

type Member = {
  user_id: number;
  nickname: string;
  account_nickname?: string | null;
  profile_image: string | null;
  role: string;
};

type GroupDetail = {
  id: number;
  name: string;
  icon: string | null;
  description: string | null;
  started_on: string | null;
  my_role: string;
  members: Member[];
};

type InviteStatus = {
  active: boolean;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number | null;
};

type InviteIssued = {
  token: string;
  invite_url: string;
  expires_at: string;
  max_uses: number;
};

type MeetingLite = {
  id: number;
  group_id: number;
  title: string;
  location: string;
  meeting_time: string;
  status: string;
};

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function startOfToday() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

// 약속 날짜가 오늘이면 "오늘", 아니면 "D-3"
function dLabel(iso: string) {
  const d = new Date(iso);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round(
    (day.getTime() - startOfToday().getTime()) / 86400000,
  );
  return diff <= 0 ? "오늘" : `D-${diff}`;
}

function whenLabel(iso: string) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]}) ${hh}:${mm}`;
}

const AVATAR_TONES = ["", "peach", "lavender"];

function formatTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("ko-KR") : "-";
}

export default function GroupDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const groupId = params.id;

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [invite, setInvite] = useState<InviteStatus | null>(null);
  const [issued, setIssued] = useState<InviteIssued | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [meetings, setMeetings] = useState<MeetingLite[] | null>(null); // null = 불러오는 중

  function handleError(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      router.push("/login");
      return;
    }
    if (err instanceof ApiError && err.status === 403) {
      setError("이 그룹에 접근할 수 없습니다.");
      return;
    }
    setError(err instanceof ApiError ? err.message : "오류가 발생했습니다.");
  }

  const loadInvite = useCallback(async () => {
    try {
      setInvite(await api<InviteStatus>(`/groups/${groupId}/invite`));
    } catch (err) {
      handleError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const loadGroup = useCallback(async () => {
    try {
      const data = await api<GroupDetail>(`/groups/${groupId}`);
      const mode = readNameMode();
      setGroup({
        ...data,
        members: data.members.map((m) => ({
          ...m,
          nickname: pickName(m, mode),
        })),
      });
      if (data.my_role === "owner") {
        await loadInvite();
      }
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, loadInvite]);

  useEffect(() => {
    loadGroup();
  }, [loadGroup]);

  // 이 그룹의 약속 (실패해도 홈은 그대로 보이게 빈 목록으로 둔다)
  useEffect(() => {
    let cancelled = false;
    api<MeetingLite[]>(`/groups/${groupId}/meetings`)
      .then((list) => {
        if (!cancelled) setMeetings(list);
      })
      .catch(() => {
        if (!cancelled) setMeetings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  async function onIssue() {
    setError("");
    setCopied(false);
    try {
      setIssued(
        await api<InviteIssued>(`/groups/${groupId}/invite`, {
          method: "POST",
        }),
      );
      await loadInvite();
    } catch (err) {
      handleError(err);
    }
  }

  async function onRevoke() {
    setError("");
    try {
      await api(`/groups/${groupId}/invite`, { method: "DELETE" });
      setIssued(null);
      await loadInvite();
    } catch (err) {
      handleError(err);
    }
  }

  async function onCopy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.invite_url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  // 방장이 멤버를 내보낸다
  async function onKick(m: Member) {
    if (!window.confirm(`${m.nickname}님을 이 그룹에서 내보낼까요?`)) return;
    setError("");
    try {
      await api(`/groups/${groupId}/members/${m.user_id}`, {
        method: "DELETE",
      });
      await loadGroup();
    } catch (err) {
      handleError(err);
    }
  }

  // 멤버가 스스로 그룹을 나간다
  async function onLeave() {
    const wasOwner = group?.my_role === "owner";
    const lastOne = (group?.members.length ?? 0) <= 1;
    const msg = lastOne
      ? "마지막 멤버예요. 나가면 아무도 이 그룹에 들어올 수 없게 돼요. 그래도 나갈까요?"
      : wasOwner
        ? "방장이 나가면 먼저 들어온 멤버가 방장이 돼요. 나갈까요?"
        : "이 그룹에서 나갈까요? 공유 중인 내 위치도 함께 사라져요.";
    if (!window.confirm(msg)) return;
    setError("");
    try {
      await api(`/groups/${groupId}/members/me`, { method: "DELETE" });
      try {
        // 나간 그룹이 '마지막으로 연 그룹'으로 남지 않게 지운다
        localStorage.removeItem(LAST_GROUP_KEY);
      } catch {
        /* 무시 */
      }
      router.push("/groups");
    } catch (err) {
      handleError(err);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="card muted">불러오는 중...</div>
      </AppShell>
    );
  }

  if (!group) {
    return (
      <AppShell>
        <div className="error">{error || "그룹을 불러오지 못했습니다."}</div>
        <Link href="/groups" className="link-arrow">
          ← 내 그룹으로
        </Link>
      </AppShell>
    );
  }

  const isOwner = group.my_role === "owner";
  const hasLink = invite !== null && invite.max_uses !== null;

  // 오늘 이후 확정 약속 중 가장 가까운 것
  const nextMeeting = (meetings ?? [])
    .filter(
      (m) =>
        m.status?.toLowerCase() === "confirmed" &&
        new Date(m.meeting_time).getTime() >= startOfToday().getTime(),
    )
    .sort(
      (a, b) =>
        new Date(a.meeting_time).getTime() - new Date(b.meeting_time).getTime(),
    )[0];

  return (
    <AppShell
      group={{
        id: group.id,
        name: group.name,
        icon: group.icon,
        memberNicknames: group.members.map((m) => m.nickname),
      }}
    >
      <p style={{ marginBottom: 16 }}>
        <Link href="/groups" className="link-arrow">
          ← 내 그룹
        </Link>
      </p>

      <div className="page-head">
        <div>
          <p className="eyebrow">
            {isOwner ? "내가 만든 그룹" : "함께하는 그룹"}
          </p>
          <h1 className="page-title">
            {group.icon ? `${group.icon} ` : ""}
            {group.name}
          </h1>
          {group.description && <p className="page-sub">{group.description}</p>}
          {ddayLabel(group.started_on) && (
            <p className="meta" style={{ marginTop: 6 }}>
              🗓 {ddayLabel(group.started_on)}
            </p>
          )}
        </div>
        <span className="chip">{isOwner ? "방장" : "멤버"}</span>
      </div>

      {error && <div className="error">{error}</div>}

      {/* 다음 약속: 들어오자마자 가장 궁금한 것 */}
      <section className="card mint" style={{ marginBottom: 16 }}>
        <p className="meta" style={{ marginBottom: 6 }}>
          다음 약속
        </p>
        {meetings === null ? (
          <p className="muted">불러오는 중…</p>
        ) : nextMeeting ? (
          <div
            className="row-between"
            style={{ gap: 16, flexWrap: "wrap", alignItems: "center" }}
          >
            <div>
              <h2 className="card-title">
                <span className="chip" style={{ marginRight: 8 }}>
                  {dLabel(nextMeeting.meeting_time)}
                </span>
                {nextMeeting.title}
              </h2>
              <p className="muted" style={{ marginTop: 6 }}>
                {whenLabel(nextMeeting.meeting_time)}
                {nextMeeting.location ? ` · 📍 ${nextMeeting.location}` : ""}
              </p>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Link
                href={`/groups/${group.id}/meetings`}
                className="btn sm"
                style={{ textDecoration: "none" }}
              >
                약속 보기
              </Link>
              <Link
                href={`/groups/${group.id}/chat`}
                className="btn secondary sm"
                style={{ textDecoration: "none" }}
              >
                채팅방으로
              </Link>
            </div>
          </div>
        ) : (
          <div
            className="row-between"
            style={{ gap: 16, flexWrap: "wrap", alignItems: "center" }}
          >
            <p className="muted">아직 예정된 약속이 없어요.</p>
            <Link
              href={`/groups/${group.id}/meetings`}
              className="btn sm"
              style={{ textDecoration: "none" }}
            >
              + 약속 만들기
            </Link>
          </div>
        )}
      </section>

      {/* 우리 그룹 약속 달력 */}
      <section style={{ marginBottom: 32 }}>
        <div className="row-between" style={{ marginBottom: 16 }}>
          <h2 className="section-title">약속 달력</h2>
        </div>
        <div className="card">
          <GroupsMeetingCalendar
            groups={[{ id: group.id, name: group.name, icon: group.icon }]}
            meetings={meetings ?? []}
          />
        </div>
      </section>

      <div className="grid-main">
        <section className="card">
          <div className="row-between" style={{ marginBottom: 12 }}>
            <h2 className="card-title">함께하는 친구들</h2>
            <span className="meta">{group.members.length}명</span>
          </div>
          <div>
            {group.members.map((m, i) => (
              <div
                className="row-between"
                key={m.user_id}
                style={{ padding: "10px 0" }}
              >
                <div className="row">
                  <Avatar
                    userId={m.user_id}
                    name={m.nickname}
                    image={m.profile_image}
                    size="lg"
                    tone={AVATAR_TONES[i % AVATAR_TONES.length]}
                  />
                  <strong>{m.nickname}</strong>
                </div>
                <div className="row">
                  {m.role === "owner" ? (
                    <span className="chip">방장</span>
                  ) : (
                    <span className="chip outline">멤버</span>
                  )}
                  {isOwner && m.role !== "owner" && (
                    <button
                      className="btn secondary sm"
                      onClick={() => onKick(m)}
                    >
                      내보내기
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {isOwner ? (
          <section className="card mint">
            <h2 className="card-title" style={{ marginBottom: 4 }}>
              친구 초대하기
            </h2>
            <p className="muted" style={{ marginBottom: 16 }}>
              링크를 받은 친구가 참여하면 이 그룹의 이야기를 함께 이어갈 수
              있어요.
            </p>

            {invite && (
              <div className="card" style={{ padding: 16, marginBottom: 14 }}>
                <p className="meta" style={{ marginBottom: 4 }}>
                  현재 링크
                </p>
                <p>
                  {!hasLink
                    ? "아직 만든 링크가 없어요."
                    : invite.active
                      ? `사용 가능 · ${invite.used_count}/${invite.max_uses}회 사용 · ${formatTime(invite.expires_at)}까지`
                      : "만료되었거나 모두 사용됐어요."}
                </p>
              </div>
            )}

            <div className="row" style={{ flexWrap: "wrap" }}>
              <button className="btn" onClick={onIssue}>
                {hasLink ? "새 링크 만들기" : "초대 링크 만들기"}
              </button>
              {hasLink && (
                <button className="btn secondary" onClick={onRevoke}>
                  링크 회수
                </button>
              )}
            </div>
            {hasLink && (
              <p className="meta" style={{ marginTop: 10 }}>
                새 링크를 만들면 기존 링크는 사라져요.
              </p>
            )}

            {issued && (
              <div className="card" style={{ padding: 16, marginTop: 16 }}>
                <p className="meta" style={{ marginBottom: 8 }}>
                  이 주소는 지금 한 번만 보여요. 복사해서 친구에게 보내 주세요.
                </p>
                <input
                  className="input"
                  type="text"
                  readOnly
                  value={issued.invite_url}
                />
                <div className="row-between" style={{ marginTop: 12 }}>
                  <span className="meta">
                    {formatTime(issued.expires_at)}까지 · 최대 {issued.max_uses}
                    명
                  </span>
                  <button className="btn secondary sm" onClick={onCopy}>
                    {copied ? "복사됨 ✓" : "링크 복사"}
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : (
          <section className="card mint">
            <h2 className="card-title" style={{ marginBottom: 4 }}>
              초대는 방장이 해요
            </h2>
            <p className="muted">
              친구를 더 부르고 싶다면 방장에게 초대 링크를 부탁해 보세요.
            </p>
          </section>
        )}
      </div>

      <section
        className="row-between"
        style={{ marginTop: 28, gap: 12, flexWrap: "wrap" }}
      >
        <p className="meta">
          나가면 이 그룹의 채팅과 사진을 볼 수 없어요. 다시 들어오려면 초대
          링크가 필요해요.
          {isOwner && " 방장이 나가면 먼저 들어온 멤버가 방장이 돼요."}
        </p>
        <button className="btn secondary sm" onClick={onLeave}>
          그룹 나가기
        </button>
      </section>
    </AppShell>
  );
}
