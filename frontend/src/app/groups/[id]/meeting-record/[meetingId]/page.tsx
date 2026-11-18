'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import type { MeetingRecord } from '@/lib/records'

export default function MeetingRecordLinkPage() {
  const { id, meetingId } = useParams<{ id: string; meetingId: string }>()
  const router = useRouter()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setError('')
    if (!/^\d+$/.test(id) || !/^\d+$/.test(meetingId)) {
      setError('올바르지 않은 약속 주소예요.')
      return
    }
    // The records endpoint synchronizes past meetings and enforces group membership.
    api<MeetingRecord[]>(`/groups/${id}/records`)
      .then((records) => {
        if (!active) return
        const record = records.find(
          (r) =>
            r.group_id === Number(id) && r.meeting_id === Number(meetingId),
        )
        if (record) router.replace(`/groups/${id}/records/${record.id}`)
        else
          setError(
            '이 약속에 연결된 지난 기록을 찾지 못했어요. 삭제된 기록인지 확인해 주세요.',
          )
      })
      .catch(() => {
        if (active)
          setError(
            '지난 기록을 불러오지 못했어요. 로그인 상태와 연결을 확인하고 다시 시도해 주세요.',
          )
      })
    return () => {
      active = false
    }
  }, [id, meetingId, router, attempt])

  return (
    <main style={{ maxWidth: 600, margin: '40px auto', padding: 20 }}>
      <h1>지난 약속 기록</h1>
      <p role={error ? 'alert' : 'status'}>
        {error || '해당 약속의 추억으로 이동하고 있어요…'}
      </p>
      {error && (
        <button
          type="button"
          className="btn"
          onClick={() => setAttempt((v) => v + 1)}
        >
          다시 시도
        </button>
      )}
      <p>
        <Link href={`/groups/${id}/records`}>지난 기록 목록 보기 →</Link>
      </p>
      <p>
        <Link href={`/groups/${id}`}>그룹 홈으로 돌아가기</Link>
      </p>
    </main>
  )
}
