"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import AppShell from "@/components/AppShell";
import { LAST_GROUP_KEY } from "@/components/Sidebar";
import NameModeCard from "@/components/NameModeCard";
import LinkedAccountsCard from "@/components/LinkedAccountsCard";
import ProfilePhotoCard from "@/components/ProfilePhotoCard";

type Me = {
  id: number;
  nickname: string;
  email: string | null;
  profile_image: string | null;
};

const CONFIRM_TEXT = "탈퇴";

export default function SettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const [nickname, setNickname] = useState("");
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState("");

  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState("");

  useEffect(() => {
    api<Me>("/auth/me")
      .then((m) => {
        setMe(m);
        setNickname(m.nickname);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
        }
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setProfileError("");
    const trimmed = nickname.trim();
    if (!trimmed) {
      setProfileError("닉네임을 입력하세요.");
      return;
    }
    setSaving(true);
    try {
      await api("/auth/me", { method: "PATCH", body: { nickname: trimmed } });
      // 헤더의 닉네임도 바뀌도록 화면을 새로 불러온다
      window.location.reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setProfileError(
        err instanceof ApiError ? err.message : "저장하지 못했어요.",
      );
      setSaving(false);
    }
  }

  async function onWithdraw(e: React.FormEvent) {
    e.preventDefault();
    setWithdrawError("");
    setWithdrawing(true);
    try {
      await api("/auth/me", {
        method: "DELETE",
        body: { confirm, password: password || null },
      });
      try {
        localStorage.removeItem(LAST_GROUP_KEY);
      } catch {
        /* 무시 */
      }
      router.push("/login");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setWithdrawError(
        err instanceof ApiError ? err.message : "탈퇴하지 못했어요.",
      );
      setWithdrawing(false);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="card muted">불러오는 중...</div>
      </AppShell>
    );
  }

  if (!me) {
    return (
      <AppShell>
        <div className="error">내 정보를 불러오지 못했어요.</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page-head">
        <div>
          <p className="eyebrow">내 계정</p>
          <h1 className="page-title">설정</h1>
          <p className="page-sub">프로필을 고치거나 계정을 정리할 수 있어요.</p>
        </div>
      </div>

      <div style={{ display: "grid", gap: 20, maxWidth: 560 }}>
        <ProfilePhotoCard
          userId={me.id}
          nickname={me.nickname}
          image={me.profile_image}
          onChange={(img) => setMe({ ...me, profile_image: img })}
        />
        <section className="card">
          <h2 className="card-title" style={{ marginBottom: 12 }}>
            프로필
          </h2>
          {profileError && <div className="error">{profileError}</div>}
          <form onSubmit={onSave}>
            <div className="field">
              <label htmlFor="nickname">닉네임</label>
              <input
                id="nickname"
                className="input"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={20}
                required
              />
              <span className="hint">{nickname.length} / 20자</span>
            </div>
            {me.email && (
              <div className="field">
                <label htmlFor="email">이메일</label>
                <input id="email" className="input" value={me.email} readOnly />
              </div>
            )}
            <button className="btn" type="submit" disabled={saving}>
              {saving ? "저장 중…" : "저장하기"}
            </button>
          </form>
        </section>

        <NameModeCard />

        <LinkedAccountsCard />

        <section className="card">
          <h2 className="card-title" style={{ marginBottom: 4 }}>
            회원 탈퇴
          </h2>
          <p className="muted" style={{ marginBottom: 12 }}>
            탈퇴하면 로그인할 수 없고, 이메일·이름·프로필 같은 개인정보가
            삭제돼요. 지난 채팅은 &quot;탈퇴한 사용자&quot;로 남아요. 방장이던
            그룹은 남은 멤버 중 먼저 들어온 사람에게 넘어가요.
          </p>
          {withdrawError && <div className="error">{withdrawError}</div>}
          <form onSubmit={onWithdraw}>
            <div className="field">
              <label htmlFor="password">비밀번호 (이메일로 가입한 경우)</label>
              <input
                id="password"
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="field">
              <label htmlFor="confirm">
                확인을 위해 &quot;{CONFIRM_TEXT}&quot;를 입력하세요
              </label>
              <input
                id="confirm"
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <button
              className="btn"
              type="submit"
              style={{ background: "#B54A3F" }}
              disabled={withdrawing || confirm !== CONFIRM_TEXT}
            >
              {withdrawing ? "처리 중…" : "탈퇴하기"}
            </button>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
