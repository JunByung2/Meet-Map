'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'

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

const POLL_MS = 5000

/** 채팅방 투표 하나(pollId)의 항목·득표·종료 여부를 불러온다. 5초마다 새로 확인한다. */
export function useVotePoll(groupId: number, pollId: string, active = true) {
  const [items, setItems] = useState<Candidate[] | null>(null)

  const reload = useCallback(async () => {
    try {
      const all = await api<Candidate[]>(`/groups/${groupId}/meeting-candidates`)
      setItems(all.filter((c) => c.poll_id === pollId))
    } catch {
      /* 일시적인 오류는 다음 새로고침에서 다시 시도한다 */
    }
  }, [groupId, pollId])

  useEffect(() => {
    if (!active) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
    const timer = window.setInterval(() => {
      if (!document.hidden) void reload()
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [reload, active])

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
