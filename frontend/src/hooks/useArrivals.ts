'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type ArrivalStatus = 'arrived' | 'moving' | 'sharing' | 'not_sharing'

export type ArrivalMember = {
  user_id: number
  nickname: string | null
  status: ArrivalStatus
  distance_m: number | null // 공유 중이고 약속 장소 좌표를 알 때만 (100m 단위)
  mine: boolean
}

export type Arrivals = {
  meeting: {
    id: number
    title: string
    location: string
    meeting_time: string
  } | null
  destination_known: boolean
  arrive_meters: number
  summary: {
    arrived: number
    moving: number
    sharing: number
    not_sharing: number
  }
  members: ArrivalMember[]
}

const REFRESH_MS = 15_000

/** 약속이 임박했을 때의 도착 현황. 임박한 확정 약속이 없으면 arrivals.meeting 이 null 이다. */
export function useArrivals(groupId: number) {
  const [arrivals, setArrivals] = useState<Arrivals | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const activeGroup = useRef(groupId)

  const reload = useCallback(async () => {
    const requested = groupId
    try {
      const res = await fetch(`/api/groups/${requested}/location/arrivals`)
      if (!res.ok) return
      const data = (await res.json()) as Arrivals
      if (activeGroup.current !== requested) return
      setArrivals(data)
      setNow(Date.now())
    } catch {
      /* 일시적인 오류는 다음 확인 때 다시 시도한다 */
    }
  }, [groupId])

  useEffect(() => {
    activeGroup.current = groupId
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setArrivals(null)
    void reload()
    const timer = window.setInterval(() => {
      if (!document.hidden) void reload()
    }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [groupId, reload])

  return { arrivals, now, reload }
}
