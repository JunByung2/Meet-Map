'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import AppShell from '@/components/AppShell';

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
  const [error, setError] = useState('');

  useEffect(() => {
    api<Group[]>('/groups')
      .then(setGroups)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.push('/login');
          return;
        }
        setError(
          err instanceof ApiError ? err.message : '오류가 발생했습니다.',
        );
        setGroups([]);
      });
  }, [router]);

  return (
    <AppShell>
      <style jsx>{`
        .pick-layout {
          max-width: 820px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: 205px minmax(0, 1fr);
          gap: 16px;
          align-items: stretch;
        }
        .pick-nav-card {
          background: var(--cream);
          border: 1.5px solid var(--brown);
          border-radius: 10px;
          padding: 22px 14px;
        }
        .nav-eyebrow {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--muted);
          padding: 0 8px;
          margin-bottom: 4px;
        }
        .nav-title {
          font-size: 22px;
          font-weight: 800;
          color: var(--brown);
          padding: 0 8px;
          margin-bottom: 20px;
        }
        .active-pill {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          background: var(--brown);
          color: var(--paper);
          border-radius: 6px;
          font-size: 14px;
          font-weight: 700;
        }
        .pick-main-card {
          background: var(--cream);
          border: 1.5px solid var(--brown);
          border-radius: 10px;
          overflow: hidden;
          min-height: 440px;
          display: flex;
          flex-direction: column;
        }
        .panel-header {
          background: var(--brown);
          color: var(--paper);
          padding: 15px 24px;
        }
        .panel-eyebrow {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          opacity: 0.8;
          margin-bottom: 2px;
        }
        .panel-title {
          font-size: 17px;
          font-weight: 700;
          color: var(--paper);
        }
        .panel-body {
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .group-box {
          display: block;
          background: var(--paper);
          border: 1.5px solid var(--brown);
          border-radius: 10px;
          padding: 16px 20px;
          color: var(--brown);
          text-decoration: none;
          box-shadow: 0 2px 0 rgba(70, 48, 43, 0.12);
          transition:
            transform 0.12s ease,
            box-shadow 0.12s ease;
        }
        .group-box:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 0 rgba(70, 48, 43, 0.18);
          text-decoration: none;
        }
        .group-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: var(--sky);
          border: 1.5px solid var(--brown);
          display: grid;
          place-items: center;
          font-weight: 800;
          font-size: 16px;
          color: var(--brown);
          flex-shrink: 0;
        }
        .role-chip {
          font-size: 11px;
          font-weight: 700;
          padding: 3px 10px;
          border-radius: 999px;
          background: var(--sky);
          color: var(--brown);
        }
        @media (max-width: 760px) {
          .pick-layout {
            grid-template-columns: 1fr;
          }
          .pick-main-card {
            min-height: auto;
          }
        }
      `}</style>

      <div className="pick-layout">
        {/* 좌측 메뉴 카드 */}
        <aside className="pick-nav-card">
          <p className="nav-eyebrow">MY GROUPS</p>
          <h1 className="nav-title">그룹 설정</h1>
          <div className="active-pill">
            <span>그룹 선택</span>
            <span>›</span>
          </div>
        </aside>

        {/* 우측 상세 패널 (안쪽에 그룹별 박스 배치) */}
        <section className="pick-main-card">
          <header className="panel-header">
            <p className="panel-eyebrow">SELECT A GROUP</p>
            <h2 className="panel-title">설정할 그룹을 골라 주세요</h2>
          </header>

          <div className="panel-body">
            {error && <div className="error">{error}</div>}

            {groups === null ? (
              <div className="group-box muted">불러오는 중...</div>
            ) : groups.length === 0 ? (
              <div className="group-box">
                <p className="card-title">아직 그룹이 없어요</p>
                <p className="muted" style={{ marginTop: 6 }}>
                  그룹을 만들거나 초대 링크로 들어오면 여기서 설정할 수 있어요.
                </p>
                <Link
                  href="/groups"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    height: 40,
                    padding: '0 18px',
                    marginTop: 14,
                    borderRadius: 6,
                    background: 'var(--brown)',
                    color: 'var(--paper)',
                    fontSize: 13,
                    fontWeight: 700,
                    textDecoration: 'none',
                  }}
                >
                  그룹 만들러 가기
                </Link>
              </div>
            ) : (
              groups.map((g) => (
                <Link
                  key={g.id}
                  href={`/groups/${g.id}/settings`}
                  className="group-box"
                >
                  <div className="row-between">
                    <div className="row">
                      <span className="group-avatar">
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
                      <span className="role-chip">
                        {g.role === 'owner' ? '방장' : '멤버'}
                      </span>
                      <span
                        className="link-arrow"
                        style={{ color: 'var(--brown)' }}
                      >
                        설정 →
                      </span>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
