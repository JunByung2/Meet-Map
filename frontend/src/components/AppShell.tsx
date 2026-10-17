"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export type ShellGroup = {
  id: number;
  name: string;
  icon?: string | null;
  memberNicknames?: string[];
};

type Me = { nickname?: string };

const AVATAR_TONES = ["", "peach", "lavender"];

function Icon({ d }: { d: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  home: "M3 11l9-8 9 8M5 10v10h14V10",
  chat: "M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14",
  photo:
    "M4 5h16v14H4zM8 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM4 17l5-5 4 4 3-3 4 4",
  archive: "M3 5h18v4H3zM5 9v10h14V9M10 13h4",
};

export default function AppShell({
  group,
  active = "home",
  children,
}: {
  group?: ShellGroup;
  active?: "home" | "photos" | "map";
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [nickname, setNickname] = useState("");

  useEffect(() => {
    api<Me>("/auth/me")
      .then((me) => setNickname(me?.nickname ?? ""))
      .catch(() => {});
  }, []);

  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
    }
  }

  const initial = nickname ? nickname.slice(0, 1) : "나";

  return (
    <>
      <header className="shell-header">
        <Link href="/groups" className="brand">
          <span className="brand-logo">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
          </span>
          MeetMap
        </Link>
        <div className="header-right">
          <span>우리만 볼 수 있는 기록</span>
          <div className="header-user">
            <span className="avatar">{initial}</span>
            <span>{nickname || "나"}</span>
          </div>
          <button className="btn secondary sm" onClick={logout}>
            로그아웃
          </button>
        </div>
      </header>

      <div className="shell-body">
        <aside className="sidebar">
          {group ? (
            <div className="current-group">
              <div className="label">현재 그룹</div>
              <div className="name">
                {group.icon ? `${group.icon} ` : ""}
                {group.name}
              </div>
              {group.memberNicknames && (
                <div className="sub">친구 {group.memberNicknames.length}명</div>
              )}
            </div>
          ) : (
            <div className="current-group">
              <div className="label">내 공간</div>
              <div className="name">내 그룹</div>
              <div className="sub">그룹을 고르거나 새로 만들어요</div>
            </div>
          )}

          <nav className="nav">
            <Link
              href={group ? `/groups/${group.id}` : "/groups"}
              className={`nav-item${active === "home" ? " active" : ""}`}
            >
              <Icon d={ICONS.home} />
              그룹 홈
            </Link>
            <span className="nav-item disabled">
              <Icon d={ICONS.chat} />
              채팅
            </span>
            <span className="nav-item disabled">
              <Icon d={ICONS.calendar} />
              약속
            </span>
            {group ? (
              <Link
                href={`/groups/${group.id}/map`}
                className={`nav-item${active === "map" ? " active" : ""}`}
              >
                <Icon d={ICONS.map} />
                지도
              </Link>
            ) : (
              <span className="nav-item disabled">
                <Icon d={ICONS.map} />
                지도
              </span>
            )}
            {group ? (
              <Link
                href={`/groups/${group.id}/photos`}
                className={`nav-item${active === "photos" ? " active" : ""}`}
              >
                <Icon d={ICONS.photo} />
                사진
              </Link>
            ) : (
              <span className="nav-item disabled">
                <Icon d={ICONS.photo} />
                사진
              </span>
            )}
            <span className="nav-item disabled">
              <Icon d={ICONS.archive} />
              지난 기록
            </span>
          </nav>

          {group?.memberNicknames && group.memberNicknames.length > 0 && (
            <>
              <hr className="divider" style={{ margin: 0 }} />
              <div className="side-label">함께 기록하는 친구들</div>
              <div>
                {group.memberNicknames.map((n, i) => (
                  <div className="friend-row" key={`${n}-${i}`}>
                    <span
                      className={`avatar sm ${AVATAR_TONES[i % AVATAR_TONES.length]}`}
                    >
                      {n.slice(0, 1)}
                    </span>
                    <span>{n}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="lock-note">
            이 그룹의 사진과 대화는 그룹 친구에게만 보여요.
          </div>
        </aside>

        <main className="content">{children}</main>
      </div>
    </>
  );
}
