"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { watchApi, ApiError } from "@/lib/api";

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
    let currentMe: Me | null = null;
    let currentGroup: GroupDetail | null = null;
    setLoading(true);
    setMe(null);
    setGroup(null);
    setError("");
    const publish = () => {
      if (!currentMe || !currentGroup) return;
      setMe(currentMe);
      setGroup(currentGroup);
      setError("");
      setLoading(false);
    };
    const fail = (err: unknown) => {
      if (err instanceof ApiError && [0, 401, 403].includes(err.status)) {
        currentMe = null;
        currentGroup = null;
        setMe(null);
        setGroup(null);
        if (err.status === 401) router.push("/login");
      }
      setError(err instanceof ApiError ? err.message : "정보를 갱신하지 못했어요.");
      setLoading(false);
    };
    const stopMe = watchApi<Me>("/auth/me", (value) => { currentMe = value; publish(); }, fail);
    const stopGroup = watchApi<GroupDetail>(`/groups/${groupId}`, (value) => { currentGroup = value; publish(); }, fail);
    return () => { stopMe(); stopGroup(); };
  }, [groupId, router]);

  return { groupId, me, group: group?.id === groupId ? group : null, error, loading };
}
