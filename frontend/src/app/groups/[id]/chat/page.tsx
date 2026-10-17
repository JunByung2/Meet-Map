"use client";

import Link from "next/link";
import AppShell from "@/components/AppShell";
import ChatPanel from "@/components/chat/ChatPanel";
import { useGroupContext } from "@/hooks/useGroupContext";

export default function GroupChatPage() {
  const { group, me, error, loading } = useGroupContext();

  if (loading) {
    return (
      <AppShell active="chat">
        <div className="card muted">불러오는 중...</div>
      </AppShell>
    );
  }

  if (!group || !me) {
    return (
      <AppShell active="chat">
        <div className="error">{error || "그룹을 불러오지 못했습니다."}</div>
        <Link href="/groups" className="link-arrow">
          ← 내 그룹으로
        </Link>
      </AppShell>
    );
  }

  return (
    <AppShell
      active="chat"
      group={{
        id: group.id,
        name: group.name,
        icon: group.icon,
        memberNicknames: group.members.map((m) => m.nickname),
      }}
    >
      <ChatPanel group={group} me={me} />
    </AppShell>
  );
}
