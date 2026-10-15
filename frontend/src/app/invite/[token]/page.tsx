"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";

type JoinOut = {
  group_id: number;
  name: string;
  already_member: boolean;
};

export default function InvitePage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onJoin() {
    setError("");
    setLoading(true);
    try {
      const res = await api<JoinOut>(`/invites/${token}/join`, {
        method: "POST",
      });
      router.push(`/groups/${res.group_id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // 로그인 후 이 초대 페이지로 돌아오도록 기억해 둔다
        try {
          sessionStorage.setItem("pending_invite", `/invite/${token}`);
        } catch {
          // sessionStorage 를 못 쓰는 환경이면 그냥 넘어간다
        }
        router.push("/login");
        return;
      }
      setError(
        err instanceof ApiError ? err.message : "참여하는 중 문제가 생겼어요.",
      );
      setLoading(false);
    }
  }

  return (
    <div className="center-wrap">
      <div className="center-card">
        <div className="center-brand">
          <div className="brand">
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
          </div>
        </div>

        <div className="card">
          <p className="eyebrow">초대장이 도착했어요</p>
          <h1 className="page-title" style={{ fontSize: 26 }}>
            그룹에 초대받았어요
          </h1>
          <p className="page-sub" style={{ marginBottom: 24 }}>
            참여하면 이 그룹 친구들과 대화, 약속, 사진을 함께 나눌 수 있어요.
          </p>

          {error && <div className="error">{error}</div>}

          <button className="btn block" onClick={onJoin} disabled={loading}>
            {loading ? "참여하는 중…" : "참여하기 →"}
          </button>

          <p className="meta" style={{ marginTop: 14 }}>
            로그인이 필요하면 로그인 후 이 화면으로 자동으로 돌아와요.
          </p>
        </div>

        <div className="notice" style={{ marginTop: 16 }}>
          <strong>초대한 친구만 참여할 수 있어요</strong>
          <span className="muted">
            그룹은 검색에 노출되지 않고, 사진과 대화도 그룹 안에서만 보여요.
          </span>
        </div>
      </div>
    </div>
  );
}
