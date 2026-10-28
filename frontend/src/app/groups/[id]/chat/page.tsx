"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import ChatPanel from "@/components/chat/ChatPanel";
import { useGroupContext } from "@/hooks/useGroupContext";

export default function GroupChatPage() {
  // useSearchParams 는 Suspense 안에서 써야 빌드가 통과한다
  return (
    <Suspense fallback={null}>
      <GroupChat />
    </Suspense>
  );
}

function GroupChat() {
  const { group, me, error, loading } = useGroupContext();
  // 지난 기록의 "채팅 기록 열기"로 오면 ?date=YYYY-MM-DD → 그 날짜의 첫 대화로 이동
  const dateParam = useSearchParams().get("date");
  const focusDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : undefined;

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
      <ChatPanel group={group} me={me} focusDate={focusDate} />
    </AppShell>
  );
}
