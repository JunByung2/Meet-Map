"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import AppShell from "@/components/AppShell";

type Group = {
  id: number;
  name: string;
  icon: string | null;
  description: string | null;
  role: string;
};

/** 그룹을 열지 않은 상태에서 "그룹 설정"을 누르면 오는 화면: 설정할 그룹을 고른다 */
export default function GroupSettingsPickPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Group[]>("/groups")
      .then(setGroups)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setError(
          err instanceof ApiError ? err.message : "오류가 발생했습니다.",
        );
        setGroups([]);
      });
  }, [router]);

  return (
    <AppShell>
      <div className="page-head">
        <div>
          <p className="eyebrow">내 모든 그룹</p>
          <h1 className="page-title">그룹 설정</h1>
          <p className="page-sub">설정할 그룹을 골라 주세요.</p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {groups === null ? (
        <div className="card muted">불러오는 중...</div>
      ) : groups.length === 0 ? (
        <div className="card">
          <p className="card-title">아직 그룹이 없어요</p>
          <p className="muted" style={{ marginTop: 6 }}>
            그룹을 만들거나 초대 링크로 들어오면 여기서 설정할 수 있어요.
          </p>
          <Link
            href="/groups"
            className="btn"
            style={{ marginTop: 14, display: "inline-block" }}
          >
            그룹 만들러 가기
          </Link>
        </div>
      ) : (
        <div className="stack">
          {groups.map((g) => (
            <Link
              key={g.id}
              href={`/groups/${g.id}/settings`}
              className="card"
              style={{ color: "inherit", textDecoration: "none" }}
            >
              <div className="row-between">
                <div className="row">
                  <span className="avatar lg">
                    {g.icon ? g.icon : g.name.slice(0, 1)}
                  </span>
                  <div>
                    <p className="card-title">{g.name}</p>
                    {g.description && (
                      <p className="muted" style={{ marginTop: 2 }}>
                        {g.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className="row">
                  <span className="chip">
                    {g.role === "owner" ? "방장" : "멤버"}
                  </span>
                  <span className="link-arrow">설정 →</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
