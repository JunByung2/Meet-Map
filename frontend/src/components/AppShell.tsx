'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api, watchApi, ApiError } from '@/lib/api'
import Avatar from './Avatar'
import { useChatViewport } from '@/hooks/useChatViewport'
import Sidebar, {
  LAST_GROUP_KEY,
  type ActiveMenu,
  type ShellGroup,
} from './Sidebar'

// 다른 파일들이 AppShell 에서 가져다 쓰던 타입은 그대로 쓸 수 있게 다시 내보낸다
export type { ShellGroup }

type Me = { id?: number; nickname?: string; profile_image?: string | null }
type GroupLite = { id: number; name: string; icon?: string | null }

export default function AppShell({
  group,
  active,
  children,
}: {
  group?: ShellGroup
  active?: ActiveMenu
  children: React.ReactNode
}) {
  const router = useRouter()
  const shellRef = useChatViewport(active === 'chat')
  const switchRef = useRef<HTMLDivElement>(null)
  const [nickname, setNickname] = useState('')
  const [meId, setMeId] = useState<number | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [groups, setGroups] = useState<GroupLite[]>([])
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    return watchApi<Me>(
      '/auth/me',
      (me) => {
        setNickname(me?.nickname ?? '')
        setMeId(me?.id ?? null)
        setPhoto(me?.profile_image ?? null)
      },
      (error) => {
        if (error instanceof ApiError && [0, 401, 403].includes(error.status)) {
          setNickname('')
          setMeId(null)
          setPhoto(null)
        }
      },
    )
  }, [])

  // 그룹 전환 목록
  useEffect(() => {
    return watchApi<GroupLite[]>('/groups', setGroups, (error) => {
      if (error instanceof ApiError && [0, 401, 403].includes(error.status)) {
        setGroups([])
      }
    })
  }, [])

  // 드롭다운: 바깥을 누르거나 Esc 를 누르면 닫는다
  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: MouseEvent) {
      if (switchRef.current && !switchRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' })
    } finally {
      try {
        // 공용 컴퓨터에 그룹 이름이 남지 않게 지운다
        localStorage.removeItem(LAST_GROUP_KEY)
      } catch {
        /* 무시 */
      }
      router.push('/login')
    }
  }

  const initial = nickname ? nickname.slice(0, 1) : '나'
  const groupName = group?.name ?? '내 그룹'
  const groupMark = group?.icon || groupName.slice(0, 1)

  return (
    <div
      ref={shellRef}
      className="app-shell"
      data-layout={active === 'chat' ? 'chat' : 'page'}
    >
      <header className="shell-header">
        <div className="group-switch-wrap" ref={switchRef}>
          <button
            type="button"
            className="group-switch"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="group-mark">{groupMark}</span>
            <span className="group-name">{groupName}</span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m8 10 4 4 4-4" />
            </svg>
          </button>
          {menuOpen && (
            <div className="group-menu" role="menu">
              {groups.map((g) => (
                <Link
                  key={g.id}
                  href={`/groups/${g.id}`}
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                >
                  <span>
                    {g.icon ? `${g.icon} ` : ''}
                    {g.name}
                  </span>
                  {group?.id === g.id && <span aria-hidden="true">✓</span>}
                </Link>
              ))}
              <Link
                href="/groups"
                role="menuitem"
                className="group-menu-all"
                onClick={() => setMenuOpen(false)}
              >
                내 그룹 모두 보기
              </Link>
            </div>
          )}
        </div>

        <Link href="/groups" className="brand">
          <i />
          <span>모여락</span>
          <i />
        </Link>

        <div className="header-right">
          <Link href="/settings" className="header-user" aria-label="내 설정">
            {meId !== null ? (
              <Avatar userId={meId} name={nickname} image={photo} />
            ) : (
              <span className="avatar">{initial}</span>
            )}
            <span>{nickname || '나'}</span>
          </Link>
          <button className="btn secondary sm" onClick={logout}>
            로그아웃
          </button>
        </div>
      </header>

      <div className="shell-body">
        <Sidebar group={group} active={active} />
        <main className="content">{children}</main>
      </div>
    </div>
  )
}
