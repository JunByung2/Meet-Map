'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import AppShell, { type ShellGroup } from '@/components/AppShell'
import { api, ApiError } from '@/lib/api'
import TransitPage from '@/features/transit/TransitPage'
import MemoryMap from '@/features/memory/MemoryMap'

interface Detail {
  id: number; name: string; icon: string | null
  members: { nickname: string }[]
}

export default function MapHub() {
  const query = useSearchParams()
  const path = useParams<{ id?: string }>()
  const groupId = path.id ?? query.get('groupId')
  const memory = Boolean(groupId) && (query.get('view') === 'memory' || (Boolean(path.id) && query.get('view') !== 'transit'))
  return <MapContext key={groupId ?? 'all'} groupId={groupId ?? null} memory={memory} batch={query.get('batch')} />
}

function MapContext({ groupId, memory, batch }: { groupId: string | null; memory: boolean; batch: string | null }) {
  const [group, setGroup] = useState<ShellGroup | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [needLogin, setNeedLogin] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (groupId !== null && !/^[1-9]\d*$/.test(groupId)) {
        setError('그룹 주소가 올바르지 않아요.'); setLoading(false); return
      }
      try {
        const [, detail] = await Promise.all([
          api('/auth/me'), groupId ? api<Detail>(`/groups/${groupId}`) : Promise.resolve(null),
        ])
        if (!cancelled && detail) setGroup({ id: detail.id, name: detail.name, icon: detail.icon,
          memberNicknames: detail.members.map((member) => member.nickname) })
      } catch (err) {
        if (cancelled) return
        setNeedLogin(err instanceof ApiError && err.status === 401)
        setError(err instanceof ApiError && err.status === 403 ? '이 그룹에 접근할 수 없어요.'
          : err instanceof ApiError && err.status === 401 ? '로그인한 뒤 이 지도 주소를 다시 열어 주세요.' : '그룹·로그인 정보를 불러오지 못했어요.')
      } finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [groupId])

  const base = groupId ? `/map?groupId=${encodeURIComponent(groupId)}` : '/map'
  return <AppShell group={group}>
    {loading ? <p className="muted" role="status">지도를 준비하고 있어요.</p> : error ? <section className="card">
      <p className="error" role="alert">{error}</p>
      {needLogin && <p><Link href="/login">로그인하기</Link></p>}
      <Link href="/groups">내 그룹으로</Link>
    </section> : <>
      <div className="page-head"><div>
        <p className="eyebrow">{group ? group.name : '어디서든 편리하게'}</p>
        <h1 className="page-title">지도</h1>
        <p className="page-sub">{memory ? '그룹 친구들과 함께 남긴 장소를 돌아보세요.' : '출발지와 목적지를 정하고 교통 경로를 확인해요.'}</p>
      </div></div>
      <nav aria-label="지도 기능 선택" className="row" style={{ marginBottom: 24 }}>
        <Link aria-current={!memory ? 'page' : undefined} className={!memory ? 'btn' : 'btn secondary'}
          href={groupId ? `${base}&view=transit` : base}>교통 보기</Link>
        {group && <Link aria-current={memory ? 'page' : undefined} className={memory ? 'btn' : 'btn secondary'}
          href={`${base}&view=memory`}>추억지도</Link>}
      </nav>
      {memory && group ? <MemoryMap key={`${group.id}-${batch ?? ''}`} groupId={String(group.id)} wantedBatch={batch} /> : <TransitPage embedded />}
    </>}
  </AppShell>
}
