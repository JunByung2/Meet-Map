"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api("/auth/signup", {
        method: "POST",
        body: { email, password, nickname },
      });
      router.push("/login");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "가입 중 문제가 생겼어요.",
      );
    } finally {
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
          <p className="eyebrow">함께할 준비</p>
          <h1 className="page-title" style={{ fontSize: 26 }}>
            이메일로 가입하기
          </h1>
          <p className="page-sub" style={{ marginBottom: 24 }}>
            친구들이 알아볼 수 있는 닉네임을 정해 주세요.
          </p>

          {error && <div className="error">{error}</div>}

          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="nickname">닉네임</label>
              <input
                id="nickname"
                className="input"
                placeholder="친구들에게 보여질 이름"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={20}
                required
              />
              <span className="hint">{nickname.length} / 20자</span>
            </div>
            <div className="field">
              <label htmlFor="email">이메일</label>
              <input
                id="email"
                className="input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">비밀번호</label>
              <input
                id="password"
                className="input"
                type="password"
                placeholder="8자 이상"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
              <span className="hint">8자 이상으로 만들어 주세요.</span>
            </div>
            <button className="btn block" type="submit" disabled={loading}>
              {loading ? "가입 중…" : "가입하기"}
            </button>
          </form>

          <p className="meta" style={{ textAlign: "center", marginTop: 18 }}>
            이미 계정이 있나요? <Link href="/login">로그인</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
