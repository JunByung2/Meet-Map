'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api, ApiError } from '@/lib/api'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('error')) {
      setError('로그인에 실패했어요. 잠시 후 다시 시도해 주세요.')
    }
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api('/auth/login', {
        method: 'POST',
        body: { email, password },
      })
      router.push('/groups')
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : '로그인 중 문제가 생겼어요.',
      )
    } finally {
      setLoading(false)
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
          <p className="eyebrow">우리만의 공간으로</p>
          <h1 className="page-title" style={{ fontSize: 26 }}>
            다시 만나서 반가워요
          </h1>
          <p className="page-sub" style={{ marginBottom: 24 }}>
            친구들과 약속하고, 함께한 순간을 기록해요.
          </p>

          {error && <div className="error">{error}</div>}

          <div className="stack" style={{ gap: 10 }}>
            <a className="btn kakao block" href="/api/auth/kakao/login">
              <img className="btn-icon" src="/icons/kakao.png" alt="" />
              카카오로 시작하기
            </a>
            <a className="btn google block" href="/api/auth/google/login">
              <img className="btn-icon" src="/icons/google.png" alt="" />
              Google로 시작하기
            </a>
          </div>

          <hr className="divider" />

          <p className="meta" style={{ marginBottom: 12 }}>
            이메일 로그인
          </p>
          <form onSubmit={onSubmit}>
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
                placeholder="비밀번호"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button className="btn block" type="submit" disabled={loading}>
              {loading ? '로그인 중…' : '로그인'}
            </button>
          </form>

          <p className="meta" style={{ textAlign: 'center', marginTop: 18 }}>
            처음이신가요? <Link href="/signup">이메일로 가입하기</Link>
          </p>
        </div>

        <p className="meta" style={{ textAlign: 'center', marginTop: 16 }}>
          우리만 볼 수 있는 기록 · 초대한 친구와만 나눠요
        </p>
      </div>
    </div>
  )
}
