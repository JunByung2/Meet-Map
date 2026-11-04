"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import Avatar from "./Avatar";
import Sidebar, {
  LAST_GROUP_KEY,
  type ActiveMenu,
  type ShellGroup,
} from "./Sidebar";

// 다른 파일들이 AppShell 에서 가져다 쓰던 타입은 그대로 쓸 수 있게 다시 내보낸다
export type { ShellGroup };

type Me = { id?: number; nickname?: string; profile_image?: string | null };

export default function AppShell({
  group,
  active,
  children,
}: {
  group?: ShellGroup;
  active?: ActiveMenu;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [meId, setMeId] = useState<number | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    api<Me>("/auth/me")
      .then((me) => {
        setNickname(me?.nickname ?? "");
        setMeId(me?.id ?? null);
        setPhoto(me?.profile_image ?? null);
      })
      .catch(() => {});
  }, []);

  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      try {
        // 공용 컴퓨터에 그룹 이름이 남지 않게 지운다
        localStorage.removeItem(LAST_GROUP_KEY);
      } catch {
        /* 무시 */
      }
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
            {meId !== null ? (
              <Avatar userId={meId} name={nickname} image={photo} />
            ) : (
              <span className="avatar">{initial}</span>
            )}
            <span>{nickname || "나"}</span>
          </div>
          <Link href="/settings" className="btn secondary sm">
            설정
          </Link>
          <button className="btn secondary sm" onClick={logout}>
            로그아웃
          </button>
        </div>
      </header>

      <div className="shell-body">
        <Sidebar group={group} active={active} />
        <main className="content">{children}</main>
      </div>
    </>
  );
}
