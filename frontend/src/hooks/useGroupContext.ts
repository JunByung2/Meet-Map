"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";

export type GroupMember = {
  user_id: number;
  nickname: string;
  profile_image: string | null;
  role: string;
};

export type GroupDetail = {
  id: number;
  name: string;
  icon: string | null;
  description: string | null;
  my_role: string;
  members: GroupMember[];
};

export type Me = { id: number; nickname: string };

/**
 * /groups/[id]/... 하위 페이지 공통: 로그인 사용자 + 그룹 정보를 불러온다.
 * 로그인이 안 되어 있으면 /login 으로 보낸다.
 */
export function useGroupContext() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const groupId = Number(params.id);

  const [me, setMe] = useState<Me | null>(null);
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [meData, groupData] = await Promise.all([
          api<Me>("/auth/me"),
          api<GroupDetail>(`/groups/${groupId}`),
        ]);
        if (cancelled) return;
        setMe(meData);
        setGroup(groupData);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setError("이 그룹에 접근할 수 없습니다.");
          return;
        }
        setError(err instanceof ApiError ? err.message : "오류가 발생했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [groupId, router]);

  return { groupId, me, group, error, loading };
}
