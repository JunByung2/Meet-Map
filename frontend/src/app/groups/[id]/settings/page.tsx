'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { ddayLabel } from '@/lib/dday';
import AppShell from '@/components/AppShell';
import { pickName, readNameMode } from '@/lib/nameMode';

type Member = {
  user_id: number;
  nickname: string;
  group_nickname: string | null;
  account_nickname?: string | null;
  profile_image: string | null;
  role: string;
  is_me: boolean;
};

type GroupDetail = {
  id: number;
  name: string;
  icon: string | null;
  description: string | null;
  started_on: string | null;
  my_role: string;
  members: Member[];
};

type GroupSettingsTab = 'info' | 'alias' | 'owner';

const GROUP_MENU_ITEMS: {
  id: GroupSettingsTab;
  label: string;
  eyebrow: string;
}[] = [
  { id: 'info', label: '그룹 정보', eyebrow: 'GROUP SETTINGS' },
  { id: 'alias', label: '그룹별 이름', eyebrow: 'GROUP ALIAS' },
  { id: 'owner', label: '권한 및 관리', eyebrow: 'GROUP MANAGEMENT' },
];

export default function GroupSettingsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const groupId = params.id;

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeTab, setActiveTab] = useState<GroupSettingsTab>('info');

  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [description, setDescription] = useState('');
  const [startedOn, setStartedOn] = useState('');
  const [saving, setSaving] = useState(false);

  const [alias, setAlias] = useState('');
  const [savingAlias, setSavingAlias] = useState(false);

  const [targetId, setTargetId] = useState('');
  const [transferring, setTransferring] = useState(false);

  function handleError(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      router.push('/login');
      return;
    }
    if (err instanceof ApiError && err.status === 403) {
      setError('이 작업을 할 권한이 없습니다.');
      return;
    }
    setError(err instanceof ApiError ? err.message : '오류가 발생했습니다.');
  }

  const load = useCallback(async () => {
    try {
      const g = await api<GroupDetail>(`/groups/${groupId}`);
      const mode = readNameMode();
      setGroup({
        ...g,
        members: g.members.map((m) => ({ ...m, nickname: pickName(m, mode) })),
      });
      setName(g.name);
      setIcon(g.icon ?? '');
      setDescription(g.description ?? '');
      setStartedOn(g.started_on ?? '');
      setAlias(g.members.find((m) => m.is_me)?.group_nickname ?? '');
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    const trimmed = name.trim();
    if (!trimmed) {
      setError('그룹 이름을 입력하세요.');
      return;
    }
    setSaving(true);
    try {
      await api(`/groups/${groupId}`, {
        method: 'PATCH',
        body: {
          name: trimmed,
          icon: icon.trim(),
          description: description.trim(),
          started_on: startedOn || null,
        },
      });
      await load();
      setNotice('변경사항을 저장했어요.');
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  }

  async function onSaveAlias(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setSavingAlias(true);
    try {
      await api(`/groups/${groupId}/members/me`, {
        method: 'PATCH',
        body: { nickname: alias.trim() },
      });
      await load();
      setNotice(alias.trim() ? '별명을 저장했어요.' : '별명을 지웠어요.');
    } catch (err) {
      handleError(err);
    } finally {
      setSavingAlias(false);
    }
  }

  async function onTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!group || !targetId) return;
    const target = group.members.find((m) => String(m.user_id) === targetId);
    if (!target) return;
    if (
      !window.confirm(
        `${target.nickname}님에게 방장을 넘길까요? 나는 일반 멤버가 돼요.`,
      )
    )
      return;
    setError('');
    setNotice('');
    setTransferring(true);
    try {
      await api(`/groups/${groupId}/owner`, {
        method: 'POST',
        body: { user_id: Number(targetId) },
      });
      setTargetId('');
      await load();
      setNotice('방장을 넘겼어요.');
    } catch (err) {
      handleError(err);
    } finally {
      setTransferring(false);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="card muted" style={{ maxWidth: 820, margin: '0 auto' }}>
          불러오는 중...
        </div>
      </AppShell>
    );
  }

  if (!group) {
    return (
      <AppShell>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <div className="error">{error || '그룹을 불러오지 못했습니다.'}</div>
          <Link href="/groups" className="link-arrow">
            ← 내 그룹으로
          </Link>
        </div>
      </AppShell>
    );
  }

  const isOwner = group.my_role === 'owner';
  const others = group.members.filter((m) => m.role !== 'owner');
  const dday = ddayLabel(group.started_on);
  const currentMenu =
    GROUP_MENU_ITEMS.find((item) => item.id === activeTab) ??
    GROUP_MENU_ITEMS[0];

  const mine = group.members.find((m) => m.is_me);
  const savedAlias = mine?.group_nickname?.trim();
  const accountName = mine?.account_nickname ?? mine?.nickname;

  return (
    <AppShell
      group={{
        id: group.id,
        name: group.name,
        icon: group.icon,
        memberNicknames: group.members.map((m) => m.nickname),
      }}
      active="settings"
    >
      <style jsx>{`
        .settings-layout {
          max-width: 820px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: 205px minmax(0, 1fr);
          gap: 16px;
          align-items: stretch;
        }
        .settings-nav-card {
          background: var(--cream);
          border: 1.5px solid var(--brown);
          border-radius: 10px;
          padding: 22px 14px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .nav-eyebrow {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--muted);
          padding: 0 8px;
          margin-bottom: 4px;
        }
        .nav-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 8px;
          margin-bottom: 20px;
        }
        .nav-title {
          font-size: 22px;
          font-weight: 800;
          color: var(--brown);
        }
        .role-badge {
          font-size: 11px;
          font-weight: 700;
          padding: 3px 9px;
          border-radius: 999px;
          background: var(--sky);
          color: var(--brown);
        }
        .nav-list {
          display: flex;
          flex-direction: column;
        }
        .nav-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          border: 0;
          border-bottom: 1px solid var(--line);
          border-radius: 0;
          background: transparent;
          color: var(--brown);
          font-family: inherit;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          text-align: left;
          transition:
            background 0.15s ease,
            color 0.15s ease;
        }
        .nav-btn:last-child {
          border-bottom: 0;
        }
        .nav-btn:hover:not(.active) {
          background: rgba(70, 48, 43, 0.06);
        }
        .nav-btn.active {
          background: var(--brown);
          color: var(--paper);
          border-radius: 6px;
          border-bottom-color: transparent;
        }
        .nav-chevron {
          font-size: 15px;
          opacity: 0.85;
        }
        .settings-main-card {
          background: var(--cream);
          border: 1.5px solid var(--brown);
          border-radius: 10px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          min-height: 520px;
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
          padding: 28px 28px 24px;
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .info-grid {
          display: grid;
          grid-template-columns: 104px minmax(0, 1fr);
          gap: 24px;
          align-items: start;
        }
        .group-badge-circle {
          width: 96px;
          height: 96px;
          border-radius: 50%;
          background: var(--sky);
          border: 1.5px solid var(--brown);
          display: grid;
          place-items: center;
          font-size: 34px;
          font-weight: 800;
          color: var(--brown);
        }
        .input-wrap {
          position: relative;
        }
        .brown-input {
          height: 44px;
          width: 100%;
          padding: 0 14px;
          border-radius: 6px;
          border: 1.5px solid var(--brown);
          background: var(--paper);
          color: var(--brown);
          font-family: inherit;
          font-size: 14px;
        }
        .brown-input:focus {
          outline: 2px solid var(--brown);
          outline-offset: 1px;
        }
        .char-count {
          position: absolute;
          right: 12px;
          bottom: 11px;
          font-size: 11px;
          color: var(--muted);
        }
        .brown-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 40px;
          padding: 0 18px;
          border-radius: 6px;
          border: 0;
          background: var(--brown);
          color: var(--paper);
          font-family: inherit;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
        }
        .brown-btn:hover:not(:disabled) {
          opacity: 0.9;
        }
        .brown-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .panel-footer {
          margin-top: 32px;
          display: flex;
          justify-content: flex-end;
        }
        .leave-link {
          font-size: 12px;
          color: #b5524e;
          text-decoration: underline;
        }
        @media (max-width: 760px) {
          .settings-layout {
            grid-template-columns: 1fr;
          }
          .info-grid {
            grid-template-columns: 1fr;
          }
          .settings-main-card {
            min-height: auto;
          }
        }
      `}</style>

      <div className="settings-layout">
        {/* 좌측 메뉴 카드 */}
        <aside className="settings-nav-card">
          <div>
            <p className="nav-eyebrow">GROUP SETTINGS</p>
            <div className="nav-title-row">
              <h1 className="nav-title">그룹 설정</h1>
              <span className="role-badge">{isOwner ? '방장' : '멤버'}</span>
            </div>

            <nav className="nav-list" aria-label="그룹 설정 메뉴">
              {GROUP_MENU_ITEMS.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`nav-btn ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      setError('');
                      setNotice('');
                      setActiveTab(item.id);
                    }}
                  >
                    <span>{item.label}</span>
                    <span className="nav-chevron">›</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div style={{ padding: '16px 8px 0' }}>
            <Link
              href={`/groups/${group.id}`}
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--muted)',
              }}
            >
              ← 그룹 홈으로
            </Link>
          </div>
        </aside>

        {/* 우측 상세 패널 */}
        <section className="settings-main-card">
          <header className="panel-header">
            <p className="panel-eyebrow">{currentMenu.eyebrow}</p>
            <h2 className="panel-title">{currentMenu.label}</h2>
          </header>

          <div className="panel-body">
            <div>
              {error && <div className="error">{error}</div>}
              {notice && (
                <div
                  style={{
                    background: 'var(--mint)',
                    color: 'var(--brown)',
                    borderRadius: 6,
                    padding: '10px 14px',
                    fontSize: 13,
                    fontWeight: 700,
                    marginBottom: 16,
                  }}
                >
                  {notice}
                </div>
              )}

              {/* 탭 1: 그룹 정보 */}
              {activeTab === 'info' && (
                <div className="info-grid">
                  <div className="group-badge-circle">
                    {icon || group.icon
                      ? icon || group.icon
                      : group.name.slice(0, 1)}
                  </div>

                  <div>
                    <div style={{ marginBottom: 20 }}>
                      <p
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'var(--muted)',
                          marginBottom: 4,
                        }}
                      >
                        현재 그룹 이름
                      </p>
                      <p
                        style={{
                          fontSize: 18,
                          fontWeight: 800,
                          color: 'var(--brown)',
                        }}
                      >
                        {group.name}
                      </p>
                      <p
                        style={{
                          fontSize: 11,
                          color: 'var(--muted)',
                          marginTop: 2,
                        }}
                      >
                        {isOwner
                          ? '방장만 그룹 정보를 수정할 수 있어요'
                          : '그룹 정보는 방장만 바꿀 수 있어요'}
                      </p>
                    </div>

                    {isOwner ? (
                      <form onSubmit={onSave}>
                        <div className="field" style={{ marginBottom: 14 }}>
                          <label htmlFor="name" style={{ fontSize: 12 }}>
                            새 그룹 이름
                          </label>
                          <div className="input-wrap">
                            <input
                              id="name"
                              className="brown-input"
                              style={{ paddingRight: 54 }}
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              maxLength={50}
                              required
                            />
                            <span className="char-count">
                              {name.length}/50자
                            </span>
                          </div>
                        </div>

                        <div className="field" style={{ marginBottom: 14 }}>
                          <label htmlFor="icon" style={{ fontSize: 12 }}>
                            그룹 아이콘 (이모지)
                          </label>
                          <input
                            id="icon"
                            className="brown-input"
                            placeholder="예: 🍀"
                            value={icon}
                            onChange={(e) => setIcon(e.target.value)}
                            maxLength={20}
                          />
                        </div>

                        <div className="field" style={{ marginBottom: 14 }}>
                          <label htmlFor="description" style={{ fontSize: 12 }}>
                            그룹 한 줄 소개
                          </label>
                          <div className="input-wrap">
                            <input
                              id="description"
                              className="brown-input"
                              style={{ paddingRight: 62 }}
                              placeholder="그룹을 소개해 주세요"
                              value={description}
                              onChange={(e) => setDescription(e.target.value)}
                              maxLength={500}
                            />
                            <span className="char-count">
                              {description.length}/500자
                            </span>
                          </div>
                        </div>

                        <div className="field" style={{ marginBottom: 20 }}>
                          <label htmlFor="startedOn" style={{ fontSize: 12 }}>
                            첫 만남일
                          </label>
                          <input
                            id="startedOn"
                            className="brown-input"
                            type="date"
                            value={startedOn}
                            onChange={(e) => setStartedOn(e.target.value)}
                          />
                          <span className="hint">
                            {startedOn
                              ? '날짜를 지우면 D-day가 사라져요.'
                              : '정하면 그룹 홈에 "함께한 지 N일째"가 보여요.'}
                          </span>
                        </div>

                        <button
                          className="brown-btn"
                          type="submit"
                          disabled={saving}
                        >
                          {saving ? '저장 중…' : '변경사항 저장'}
                        </button>
                      </form>
                    ) : (
                      <div
                        style={{
                          background: 'var(--paper)',
                          border: '1.5px solid var(--brown)',
                          borderRadius: 6,
                          padding: 16,
                        }}
                      >
                        <p style={{ fontSize: 14, color: 'var(--brown)' }}>
                          {group.description || '등록된 그룹 소개가 없어요.'}
                        </p>
                        {dday && (
                          <p className="meta" style={{ marginTop: 10 }}>
                            🗓 {dday}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 탭 2: 그룹별 이름 (별명) */}
              {activeTab === 'alias' && (
                <div>
                  <div style={{ marginBottom: 20 }}>
                    <p
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: 'var(--muted)',
                        marginBottom: 4,
                      }}
                    >
                      현재 이 그룹에서 보이는 이름
                    </p>
                    <p
                      style={{
                        fontSize: 18,
                        fontWeight: 800,
                        color: 'var(--brown)',
                      }}
                    >
                      {savedAlias || accountName}
                    </p>
                    <p
                      style={{
                        fontSize: 11,
                        color: 'var(--muted)',
                        marginTop: 2,
                      }}
                    >
                      {savedAlias
                        ? `그룹 별명 적용 중 (원래 닉네임: ${accountName})`
                        : '이 그룹 친구들에게만 보일 별명을 정할 수 있어요'}
                    </p>
                  </div>

                  <form onSubmit={onSaveAlias}>
                    <div className="field" style={{ marginBottom: 20 }}>
                      <label htmlFor="alias" style={{ fontSize: 12 }}>
                        이 그룹에서 쓸 별명
                      </label>
                      <div className="input-wrap">
                        <input
                          id="alias"
                          className="brown-input"
                          style={{ paddingRight: 54 }}
                          placeholder="예: 막내, 총무 (비워두면 원래 닉네임)"
                          value={alias}
                          onChange={(e) => setAlias(e.target.value)}
                          maxLength={30}
                        />
                        <span className="char-count">{alias.length}/30자</span>
                      </div>
                    </div>

                    <button
                      className="brown-btn"
                      type="submit"
                      disabled={savingAlias}
                    >
                      {savingAlias ? '저장 중…' : '변경사항 저장'}
                    </button>
                  </form>
                </div>
              )}

              {/* 탭 3: 권한 및 관리 */}
              {activeTab === 'owner' && (
                <div>
                  <h3
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      marginBottom: 4,
                      color: 'var(--brown)',
                    }}
                  >
                    방장 넘기기
                  </h3>
                  <p
                    className="muted"
                    style={{ marginBottom: 16, fontSize: 13 }}
                  >
                    다른 멤버에게 방장을 넘기면 나는 일반 멤버가 돼요.
                  </p>

                  {!isOwner ? (
                    <p className="meta">
                      현재 일반 멤버입니다. 방장 권한이 있을 때만 위임할 수
                      있어요.
                    </p>
                  ) : others.length === 0 ? (
                    <p className="meta">넘길 수 있는 멤버가 아직 없어요.</p>
                  ) : (
                    <form onSubmit={onTransfer}>
                      <div className="field" style={{ marginBottom: 18 }}>
                        <label htmlFor="target" style={{ fontSize: 12 }}>
                          새 방장 선택
                        </label>
                        <select
                          id="target"
                          className="brown-input"
                          value={targetId}
                          onChange={(e) => setTargetId(e.target.value)}
                        >
                          <option value="">멤버를 선택하세요</option>
                          {others.map((m) => (
                            <option key={m.user_id} value={m.user_id}>
                              {m.nickname}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        className="brown-btn"
                        type="submit"
                        disabled={!targetId || transferring}
                      >
                        {transferring ? '넘기는 중…' : '방장 넘기기'}
                      </button>
                    </form>
                  )}

                  <hr className="divider" />

                  <p className="meta">
                    멤버 내보내기와 그룹 탈퇴 처리는{' '}
                    <Link href={`/groups/${group.id}`}>그룹 홈</Link>에서 진행할
                    수 있어요.
                  </p>
                </div>
              )}
            </div>

            <div className="panel-footer">
              <Link href={`/groups/${group.id}`} className="leave-link">
                그룹 나가기
              </Link>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
