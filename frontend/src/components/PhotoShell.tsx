"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AppShell, { type ShellGroup } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import "./photos.css";
import "./maps.css";

type GroupDetail = {
  id: number;
  name: string;
  icon: string | null;
  members: { nickname: string }[];
};

/**
 * 그룹별 사진 화면의 공통 틀.
 * - 그룹 정보를 불러와 AppShell(사이드바)에 넘긴다.
 * - 로그인이 안 되어 있으면 /login 으로, 그룹 멤버가 아니면 안내 문구를 보여준다.
 */
export default function PhotoShell({
  active = "photos",
  children,
}: {
  active?: "photos" | "map";
  children: (ctx: { groupId: string; onApiError: (e: unknown) => string }) => React.ReactNode;
}) {
  const router = useRouter();
  const { id: groupId } = useParams<{ id: string }>();
  const [group, setGroup] = useState<ShellGroup | null>(null);
  const [blocked, setBlocked] = useState("");
  const [loading, setLoading] = useState(true);

  function onApiError(e: unknown): string {
    if (e instanceof ApiError && e.status === 401) {
      router.push("/login");
      return "";
    }
    if (e instanceof ApiError && e.status === 403) return "이 그룹의 사진을 볼 수 있는 권한이 없어요.";
    return e instanceof ApiError ? e.message : "문제가 생겼어요. 잠시 후 다시 시도해 주세요.";
  }

  useEffect(() => {
    api<GroupDetail>(`/groups/${groupId}`)
      .then((g) =>
        setGroup({ id: g.id, name: g.name, icon: g.icon, memberNicknames: g.members.map((m) => m.nickname) }),
      )
      .catch((e) => setBlocked(onApiError(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  if (loading) {
    return (
      <AppShell active={active}>
        <div className="card muted">불러오는 중...</div>
      </AppShell>
    );
  }
  if (!group) {
    return (
      <AppShell active={active}>
        <div className="error">{blocked || "그룹을 불러오지 못했어요."}</div>
        <Link href="/groups" className="link-arrow">
          ← 내 그룹으로
        </Link>
      </AppShell>
    );
  }
  return (
    <AppShell group={group} active={active}>
      {children({ groupId, onApiError })}
    </AppShell>
  );
}
