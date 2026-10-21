'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '@/lib/api'

export function useStartPlacePlan(groupId: number, onStatus: (text: string) => void) {
  const router = useRouter()
  const busy = useRef(false)
  const request = useRef<{ groupId: number; id: string } | null>(null)
  const [starting, setStarting] = useState(false)

  async function start() {
    if (busy.current) return
    busy.current = true
    setStarting(true)
    onStatus('약속 장소 추천 링크를 만들고 있어요.')
    try {
      if (request.current?.groupId !== groupId) {
        request.current = { groupId, id: crypto.randomUUID() }
      }
      const data = await api<{ id: string; href: string }>(`/groups/${groupId}/place-plans`, {
        method: 'POST', body: { request_id: request.current.id },
      })
      onStatus('채팅에 추천 링크를 남겼어요.')
      router.push(`/recommend?groupId=${groupId}&planId=${encodeURIComponent(data.id)}`)
      // 응답 유실 재시도에는 같은 ID, 성공 후 다음 새 약속은 새 ID.
      request.current = null
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) request.current = null
      onStatus(error instanceof ApiError ? error.message : '연결하지 못했어요. 잠시 후 다시 눌러 주세요.')
    } finally {
      busy.current = false
      setStarting(false)
    }
  }
  return { start, starting }
}
