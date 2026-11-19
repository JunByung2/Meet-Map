'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import AppShell, { type ShellGroup } from '@/components/AppShell'
import { api, ApiError } from '@/lib/api'
import TransitPage from '@/features/transit/TransitPage'
import MeetingPlacesMap from '@/features/map/MeetingPlacesMap'
import MemoryMap from '@/features/memory/MemoryMap'
import MemoryTabs from '@/components/MemoryTabs'

interface Detail {
  id: number
  name: string
  icon: string | null
  members: { nickname: string }[]
}

export default function MapHub() {
  const query = useSearchParams()
  const path = useParams<{ id?: string }>()
  const groupId = path.id ?? query.get('groupId')
  const view = query.get('view')
  const meetings = view === 'meetings' // 그룹별 약속 장소 지도
  const memory =
    Boolean(groupId) &&
    !meetings &&
    (view === 'memory' || (Boolean(path.id) && view !== 'transit'))
  // 위쪽 탭(교통 경로 / 약속 장소)이 이동할 주소의 앞부분
  const tabBase = path.id
    ? `/groups/${path.id}/map?`
    : groupId
      ? `/map?groupId=${groupId}&`
      : '/map?'
  return (
    <MapContext
      key={groupId ?? 'all'}
      groupId={groupId ?? null}
      memory={memory}
      meetings={meetings}
      tabBase={tabBase}
      batch={query.get('batch')}
    />
  )
}

function MapContext({
  groupId,
  memory,
  meetings,
  tabBase,
  batch,
}: {
  groupId: string | null
  memory: boolean
  meetings: boolean
  tabBase: string
  batch: string | null
}) {
  const [group, setGroup] = useState<ShellGroup | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [needLogin, setNeedLogin] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (groupId !== null && !/^[1-9]\d*$/.test(groupId)) {
        setError('그룹 주소가 올바르지 않아요.')
        setLoading(false)
        return
      }
      try {
        const [, detail] = await Promise.all([
          api('/auth/me'),
          groupId ? api<Detail>(`/groups/${groupId}`) : Promise.resolve(null),
        ])
        if (!cancelled && detail)
          setGroup({
            id: detail.id,
            name: detail.name,
            icon: detail.icon,
            memberNicknames: detail.members.map((member) => member.nickname),
          })
      } catch (err) {
        if (cancelled) return
        setNeedLogin(err instanceof ApiError && err.status === 401)
        setError(
          err instanceof ApiError && err.status === 403
            ? '이 그룹에 접근할 수 없어요.'
            : err instanceof ApiError && err.status === 401
              ? '로그인한 뒤 이 지도 주소를 다시 열어 주세요.'
              : '그룹·로그인 정보를 불러오지 못했어요.',
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [groupId])

  return (
    <AppShell
      group={group}
      active={group && memory ? 'memories' : group ? 'map' : undefined}
    >
      {loading ? (
        <p className="muted" role="status">
          지도를 준비하고 있어요.
        </p>
      ) : error ? (
        <section className="card">
          <p className="error" role="alert">
            {error}
          </p>
          {needLogin && (
            <p>
              <Link href="/login">로그인하기</Link>
            </p>
          )}
          <Link href="/groups">내 그룹으로</Link>
        </section>
      ) : (
        <>
          {memory && group ? (
            <MemoryTabs
              groupId={group.id}
              current="map"
              sub="그룹 친구들과 함께 남긴 장소를 돌아보세요."
            />
          ) : (
            <>
              <div className="page-head">
                <div>
                  <p className="eyebrow">
                    {group ? group.name : '어디서든 편리하게'}
                  </p>
                  <h1 className="page-title">지도</h1>
                  <p className="page-sub">
                    {meetings
                      ? '내 그룹들의 약속 장소를 한눈에 봐요. 그룹마다 마커 색이 달라요.'
                      : '출발지와 목적지를 정하고 교통 경로를 확인해요.'}
                  </p>
                </div>
              </div>
              <div
                className="btn-row"
                role="tablist"
                aria-label="지도 보기"
                style={{ display: 'flex', gap: 8, marginBottom: 16 }}
              >
                <Link
                  role="tab"
                  aria-selected={!meetings}
                  href={`${tabBase}view=transit`}
                  className={`btn sm ${meetings ? 'secondary' : ''}`}
                >
                  교통 경로
                </Link>
                <Link
                  role="tab"
                  aria-selected={meetings}
                  href={`${tabBase}view=meetings`}
                  className={`btn sm ${meetings ? '' : 'secondary'}`}
                >
                  약속 장소
                </Link>
              </div>
            </>
          )}
          {memory && group ? (
            <MemoryMap
              key={`${group.id}-${batch ?? ''}`}
              groupId={String(group.id)}
              wantedBatch={batch}
            />
          ) : meetings ? (
            <MeetingPlacesMap />
          ) : (
            <TransitPage embedded />
          )}
        </>
      )}
    </AppShell>
  )
}
