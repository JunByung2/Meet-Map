'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { api } from '@/lib/api'
import { createSharedStore } from './sharedVoteStore'

export type Candidate = {
  id: number
  title: string
  location: string
  place_address?: string | null
  meeting_time: string
  poll_id: string | null
  closed: boolean
  chosen: boolean
  created_by: number
  vote_count: number
  voted_by_me: boolean
  voters?: { user_id: number; nickname: string }[]
}

const store = createSharedStore<Candidate[]>(
  groupId => api<Candidate[]>(`/groups/${groupId}/meeting-candidates`),
)
const emptySnapshot = () => null

/** 그룹 전체를 한 번 조회하고 각 카드와 투표창이 같은 결과를 사용한다. */
export function useVotePoll(groupId: number, pollId: string, active = true) {
  const subscribe = useCallback((listener: () => void) => {
    if (!active) return () => {}
    return store.subscribe(groupId, listener)
  }, [groupId, active])
  const snapshot = useCallback(() => active ? store.snapshot(groupId) : null, [groupId, active])
  const all = useSyncExternalStore(subscribe, snapshot, emptySnapshot)
  const items = useMemo(() => all?.filter(c => c.poll_id === pollId) ?? null, [all, pollId])
  const reload = useCallback(async () => {
    if (active) await store.reload(groupId)
  }, [groupId, active])
  return { items, reload }
}

export function formatWhen(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}
