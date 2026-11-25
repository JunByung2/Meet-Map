'use client'

import { useMemo, useState } from 'react'
import type { ChatMessage } from '@/hooks/useGroupMessages'
import VoteMessage, { pollRefOf } from './VoteMessage'
import styles from './actions.module.css'

const WEEK = 7 * 24 * 60 * 60 * 1000

/** 최근 일주일 동안 올라온 투표 중 가장 최근 하나만 찾습니다. */
export function useActionMessages(messages: ChatMessage[]) {
  const [now] = useState(() => Date.now())
  return useMemo(() => {
    const since = now - WEEK
    const latest = messages
      .filter((m) => {
        const time = new Date(m.created_at).getTime()
        return Number.isFinite(time) && time >= since
      })
      .filter((m) => {
        const ref = pollRefOf(m.text ?? '')
        return !!ref && ref.kind === 'vote'
      })
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime() ||
          b.id - a.id,
      )
    return { votes: latest.slice(0, 1) }
  }, [messages, now])
}

/**
 * 오른쪽 사이드바와 모바일 접이식 메뉴에서 최근 투표를 보여줍니다.
 * '바깥 투표 카드 → 안쪽 투표 카드' 중복을 제거하고 실제 투표 카드만 렌더링합니다.
 */
export default function ActionPanel({
  messages,
  groupId,
  myUserId,
  onPost,
  bare = false,
}: {
  messages: ChatMessage[]
  groupId: number
  myUserId: number
  onPost: (text: string) => Promise<unknown> | void
  bare?: boolean
}) {
  const { votes } = useActionMessages(messages)

  return (
    <section className={bare ? styles.bare : styles.actionSection} aria-label="최근 투표">
      <div className={styles.actionHeader}>
        <div className={styles.headerText}>
          <span className={styles.kicker}>VOTE</span>
          <h2 className={styles.sideTitle}>투표</h2>
        </div>
        <span className={styles.itemCount} aria-label={`최근 투표 ${votes.length}개`}>
          {votes.length}
        </span>
      </div>

      {votes.length > 0 ? (
        <div className={styles.voteList}>
          {votes.map((m) => (
            <div key={m.id} className={styles.voteItem}>
              <VoteMessage
                text={m.text ?? ''}
                groupId={groupId}
                myUserId={myUserId}
                onPost={onPost}
              />
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.actionEmpty}>최근 일주일 동안 생성된 투표가 없어요.</p>
      )}
    </section>
  )
}
