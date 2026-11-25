'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import AppShell from '@/components/AppShell';
import { LAST_GROUP_KEY } from '@/components/Sidebar';
import NameModeCard from '@/components/NameModeCard';
import LinkedAccountsCard from '@/components/LinkedAccountsCard';

type Me = {
  id: number;
  nickname: string;
  email: string | null;
  profile_image: string | null;
};

type SettingsTab = 'profile' | 'accounts' | 'nameMode' | 'privacy';

const MENU_ITEMS: { id: SettingsTab; label: string; eyebrow: string }[] = [
  { id: 'profile', label: '프로필', eyebrow: 'PERSONAL SETTINGS' },
  { id: 'accounts', label: '계정 연동', eyebrow: 'CONNECTED ACCOUNTS' },
  { id: 'nameMode', label: '그룹별 이름', eyebrow: 'DISPLAY NAME' },
  { id: 'privacy', label: '개인정보', eyebrow: 'PRIVACY & ACCOUNT' },
];

const CONFIRM_TEXT = '탈퇴';

// 기본 사진 파일이 생기면 여기에 경로를 넣어주세요 (예: "/images/default-profile.png")
const DEFAULT_AVATAR_URL = '';

function resolveAvatarUrl(image: string | null): string | null {
  if (!image) return DEFAULT_AVATAR_URL || null;
  const trimmed = image.trim();
  if (!trimmed) return DEFAULT_AVATAR_URL || null;

  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('/')
  ) {
    return trimmed;
  }

  return `/api/${trimmed}`;
}

export default function SettingsPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [imgLoadFailed, setImgLoadFailed] = useState(false);
  const [avatarSrcOverride, setAvatarSrcOverride] = useState<string | null>(
    null,
  );

  const [nickname, setNickname] = useState('');
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileNotice, setProfileNotice] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState('');

  useEffect(() => {
    api<Me>('/auth/me')
      .then((m) => {
        setMe(m);
        setNickname(m.nickname);
        setImgLoadFailed(false);
        setAvatarSrcOverride(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.push('/login');
        }
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !me) return;

    setProfileError('');
    setProfileNotice('');
    setUploadingPhoto(true);

    // 선택한 파일을 즉시 원형 아바타에 표시
    const previewUrl = URL.createObjectURL(file);
    setImgLoadFailed(false);
    setAvatarSrcOverride(previewUrl);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const endpoints = ['/api/avatar', '/api/auth/me/avatar'];
      let uploaded = false;
      let serverImage: string | null = null;
      let lastErrMsg = '사진을 바꾸지 못했어요.';

      for (const endpoint of endpoints) {
        const res = await fetch(endpoint, {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
        if (res.ok) {
          uploaded = true;
          const data = (await res.json().catch(() => ({}))) as {
            profile_image?: string | null;
            avatar_url?: string | null;
            url?: string | null;
          };
          serverImage =
            data.profile_image ?? data.avatar_url ?? data.url ?? null;
          break;
        }
        const errData = await res.json().catch(() => ({}));
        if (errData?.detail) {
          lastErrMsg = String(errData.detail);
        }
      }

      if (!uploaded) {
        throw new Error(lastErrMsg);
      }

      const freshMe = await api<Me>('/auth/me').catch(() => null);
      const rawFinal = freshMe?.profile_image || serverImage;

      if (rawFinal) {
        const resolved = resolveAvatarUrl(rawFinal);
        if (resolved) {
          const cacheBusted = `${resolved}${
            resolved.includes('?') ? '&' : '?'
          }t=${Date.now()}`;
          // 서버 이미지 로드 테스트 후 성공할 때만 서버 URL로 교체, 실패하면 미리보기(previewUrl) 유지
          const testImg = new window.Image();
          testImg.onload = () => {
            setImgLoadFailed(false);
            setAvatarSrcOverride(cacheBusted);
            setMe((prev) =>
              prev ? { ...prev, profile_image: rawFinal } : prev,
            );
          };
          testImg.onerror = () => {
            setImgLoadFailed(false);
            setAvatarSrcOverride(previewUrl);
          };
          testImg.src = cacheBusted;
        }
      } else {
        setMe((prev) => (prev ? { ...prev, profile_image: previewUrl } : prev));
      }

      setProfileNotice('프로필 사진을 바꿨어요.');
    } catch (err) {
      setAvatarSrcOverride(null);
      setProfileError(
        err instanceof Error ? err.message : '사진을 바꾸지 못했어요.',
      );
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setProfileError('');
    setProfileNotice('');
    const trimmed = nickname.trim();
    if (!trimmed) {
      setProfileError('닉네임을 입력하세요.');
      return;
    }
    setSaving(true);
    try {
      await api('/auth/me', { method: 'PATCH', body: { nickname: trimmed } });
      window.location.reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setProfileError(
        err instanceof ApiError ? err.message : '저장하지 못했어요.',
      );
      setSaving(false);
    }
  }

  async function onWithdraw(e: React.FormEvent) {
    e.preventDefault();
    setWithdrawError('');
    setWithdrawing(true);
    try {
      await api('/auth/me', {
        method: 'DELETE',
        body: { confirm, password: password || null },
      });
      try {
        localStorage.removeItem(LAST_GROUP_KEY);
      } catch {
        /* 무시 */
      }
      router.push('/login');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setWithdrawError(
        err instanceof ApiError ? err.message : '탈퇴하지 못했어요.',
      );
      setWithdrawing(false);
    }
  }

  if (loading) {
    return (
      <AppShell active="settings">
        <div className="card muted" style={{ maxWidth: 820, margin: '0 auto' }}>
          불러오는 중...
        </div>
      </AppShell>
    );
  }

  if (!me) {
    return (
      <AppShell active="settings">
        <div className="error" style={{ maxWidth: 820, margin: '0 auto' }}>
          내 정보를 불러오지 못했어요.
        </div>
      </AppShell>
    );
  }

  const currentMenu =
    MENU_ITEMS.find((item) => item.id === activeTab) ?? MENU_ITEMS[0];
  const avatarSrc = avatarSrcOverride ?? resolveAvatarUrl(me.profile_image);
  const showPhoto = Boolean(avatarSrc && !imgLoadFailed);

  return (
    <AppShell active="settings">
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
          min-height: 500px;
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
          padding: 28px;
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .profile-row {
          display: flex;
          align-items: flex-start;
          gap: 28px;
        }
        .avatar-col {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }
        .avatar-circle {
          width: 96px;
          height: 96px;
          border-radius: 50%;
          background: var(--sky);
          border: 1.5px solid var(--brown);
          display: grid;
          place-items: center;
          font-size: 32px;
          font-weight: 800;
          color: var(--brown);
          overflow: hidden;
        }
        .avatar-circle img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .photo-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 30px;
          padding: 0 12px;
          border-radius: 6px;
          border: 1px solid var(--brown);
          background: var(--paper);
          color: var(--brown);
          font-family: inherit;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
        }
        .photo-btn:hover:not(:disabled) {
          background: var(--brown);
          color: var(--paper);
        }
        .photo-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .form-col {
          flex: 1;
          min-width: 0;
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
        .withdraw-link-btn {
          background: none;
          border: 0;
          padding: 0;
          font-family: inherit;
          font-size: 12px;
          color: #b5524e;
          text-decoration: underline;
          cursor: pointer;
        }
        @media (max-width: 760px) {
          .settings-layout {
            grid-template-columns: 1fr;
          }
          .profile-row {
            flex-direction: column;
            align-items: stretch;
          }
          .settings-main-card {
            min-height: auto;
          }
        }
      `}</style>

      <div className="settings-layout">
        <aside className="settings-nav-card">
          <p className="nav-eyebrow">MY ACCOUNT</p>
          <h1 className="nav-title">설정</h1>

          <nav className="nav-list" aria-label="설정 메뉴">
            {MENU_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-btn ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    setProfileError('');
                    setProfileNotice('');
                    setActiveTab(item.id);
                  }}
                >
                  <span>{item.label}</span>
                  <span className="nav-chevron">›</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="settings-main-card">
          <header className="panel-header">
            <p className="panel-eyebrow">{currentMenu.eyebrow}</p>
            <h2 className="panel-title">{currentMenu.label}</h2>
          </header>

          <div className="panel-body">
            <div>
              {activeTab === 'profile' && (
                <div className="profile-row">
                  <div className="avatar-col">
                    <div className="avatar-circle">
                      {showPhoto && avatarSrc ? (
                        <img
                          src={avatarSrc}
                          alt={me.nickname}
                          onError={() => setImgLoadFailed(true)}
                        />
                      ) : (
                        me.nickname.slice(0, 1)
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={onPhotoChange}
                    />
                    <button
                      type="button"
                      className="photo-btn"
                      disabled={uploadingPhoto}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploadingPhoto ? '업로드 중…' : '사진 변경'}
                    </button>
                  </div>

                  <div className="form-col">
                    {profileError && (
                      <div className="error">{profileError}</div>
                    )}
                    {profileNotice && (
                      <div
                        style={{
                          background: 'var(--mint)',
                          color: 'var(--brown)',
                          borderRadius: 6,
                          padding: '8px 12px',
                          fontSize: 12,
                          fontWeight: 700,
                          marginBottom: 14,
                        }}
                      >
                        {profileNotice}
                      </div>
                    )}

                    <div style={{ marginBottom: 20 }}>
                      <p
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'var(--muted)',
                          marginBottom: 4,
                        }}
                      >
                        현재 닉네임
                      </p>
                      <p
                        style={{
                          fontSize: 18,
                          fontWeight: 800,
                          color: 'var(--brown)',
                        }}
                      >
                        {me.nickname}
                      </p>
                      <p
                        style={{
                          fontSize: 11,
                          color: 'var(--muted)',
                          marginTop: 2,
                        }}
                      >
                        친구들에게 이렇게 보여요
                      </p>
                    </div>

                    <form onSubmit={onSave}>
                      <div className="field" style={{ marginBottom: 16 }}>
                        <label
                          htmlFor="nickname"
                          style={{ fontSize: 12, color: 'var(--brown)' }}
                        >
                          새 닉네임
                        </label>
                        <div className="input-wrap">
                          <input
                            id="nickname"
                            className="brown-input"
                            style={{ paddingRight: 54 }}
                            value={nickname}
                            onChange={(e) => setNickname(e.target.value)}
                            maxLength={20}
                            required
                          />
                          <span className="char-count">
                            {nickname.length}/20자
                          </span>
                        </div>
                      </div>

                      {me.email && (
                        <div className="field" style={{ marginBottom: 20 }}>
                          <label
                            htmlFor="email"
                            style={{ fontSize: 12, color: 'var(--brown)' }}
                          >
                            연결된 이메일
                          </label>
                          <input
                            id="email"
                            className="brown-input"
                            style={{ background: 'rgba(255,250,242,0.65)' }}
                            value={me.email}
                            readOnly
                          />
                        </div>
                      )}

                      <button
                        className="brown-btn"
                        type="submit"
                        disabled={saving}
                      >
                        {saving ? '저장 중…' : '변경사항 저장'}
                      </button>
                    </form>
                  </div>
                </div>
              )}

              {activeTab === 'accounts' && <LinkedAccountsCard />}

              {activeTab === 'nameMode' && <NameModeCard />}

              {activeTab === 'privacy' && (
                <div>
                  <h3
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      marginBottom: 6,
                      color: 'var(--brown)',
                    }}
                  >
                    회원 탈퇴
                  </h3>
                  <p
                    className="muted"
                    style={{ marginBottom: 18, fontSize: 13 }}
                  >
                    탈퇴하면 로그인할 수 없고, 이메일·이름·프로필 같은
                    개인정보가 삭제돼요. 지난 채팅은 &quot;탈퇴한 사용자&quot;로
                    남아요. 방장이던 그룹은 남은 멤버 중 먼저 들어온 사람에게
                    넘어가요.{' '}
                    <Link href="/privacy">개인정보 처리방침 보기</Link>
                  </p>
                  {withdrawError && (
                    <div className="error">{withdrawError}</div>
                  )}
                  <form onSubmit={onWithdraw}>
                    <div className="field">
                      <label htmlFor="password" style={{ fontSize: 12 }}>
                        비밀번호 (이메일로 가입한 경우)
                      </label>
                      <input
                        id="password"
                        className="brown-input"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="confirm" style={{ fontSize: 12 }}>
                        확인을 위해 &quot;{CONFIRM_TEXT}&quot;를 입력하세요
                      </label>
                      <input
                        id="confirm"
                        className="brown-input"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                      />
                    </div>
                    <button
                      className="brown-btn"
                      type="submit"
                      style={{ background: '#B54A3F' }}
                      disabled={withdrawing || confirm !== CONFIRM_TEXT}
                    >
                      {withdrawing ? '처리 중…' : '탈퇴하기'}
                    </button>
                  </form>
                </div>
              )}
            </div>

            {activeTab !== 'privacy' && (
              <div className="panel-footer">
                <button
                  type="button"
                  className="withdraw-link-btn"
                  onClick={() => setActiveTab('privacy')}
                >
                  회원 탈퇴
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
