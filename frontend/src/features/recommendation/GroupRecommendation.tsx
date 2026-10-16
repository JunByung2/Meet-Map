'use client'

import { useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import RecommendationPage from './RecommendationPage'

interface Me {
  id: number
  nickname: string
}

interface Group {
  id: number
  name: string
  members: {
    user_id: number
    nickname: string
    role: string
  }[]
}

export default function GroupRecommendation() {
  const [me, setMe] = useState<Me | null>(null)
  const [group, setGroup] = useState<Group | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [needLogin, setNeedLogin] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const groupId = new URLSearchParams(window.location.search).get('groupId')

      if (!groupId || !/^[1-9]\d*$/.test(groupId)) {
        setError('그룹 정보가 없어요. 그룹에서 추천 링크를 열어 주세요.')
        setLoading(false)
        return
      }

      try {
        const [user, groupData] = await Promise.all([
          api<Me>('/auth/me'),
          api<Group>(`/groups/${groupId}`),
        ])

        if (cancelled) return

        if (!groupData.members.some((member) => member.user_id === user.id)) {
          setError('이 그룹의 멤버만 사용할 수 있어요.')
          return
        }

        setMe(user)
        setGroup(groupData)
      } catch (err) {
        if (cancelled) return

        if (err instanceof ApiError && err.status === 401) {
          setNeedLogin(true)
          setError('로그인한 다음 이 추천 링크를 다시 열어 주세요.')
        } else if (err instanceof ApiError && err.status === 403) {
          setError('이 그룹에 접근할 권한이 없어요.')
        } else {
          setError('그룹 정보를 불러오지 못했어요. 백엔드를 확인해 주세요.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [])

  if (loading) return <p>로그인·그룹 정보를 확인하고 있어요.</p>

  if (error) {
    return (
      <div>
        <p role="alert">{error}</p>
        {needLogin && (
          <p>
            <a href="/login">로그인하러 가기</a>
          </p>
        )}
        <a href="/groups">내 그룹으로 돌아가기</a>
      </div>
    )
  }

  if (!me || !group) return null

  return (
    <>
      <p style={{ color: '#247C73', marginBottom: 16 }}>
        {group.name} · {me.nickname}님으로 로그인 중
      </p>

      <RecommendationPage
        key={`${group.id}-${me.id}`}
        currentUserId={me.id}
        members={group.members}
      />
    </>
  )
}
