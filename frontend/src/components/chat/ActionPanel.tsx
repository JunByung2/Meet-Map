'use client'

import { useMemo, useState } from 'react'
import type { ChatMessage } from '@/hooks/useGroupMessages'
import VoteMessage, { pollRefOf } from './VoteMessage'
import PlanMessage from '@/features/recommendation/PlanMessage'
import styles from './actions.module.css'

const WEEK = 7 * 24 * 60 * 60 * 1000
const PLACE_PLAN_LINE =
  /^\/recommend\?groupId=([1-9]\d*)&planId=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/** 최근 7일 이내에서 가장 최근 투표 1개 / 장소 선택 1개 */
export function useActionMessages(messages: ChatMessage[]) {
  const [now] = useState(() => Date.now())
  return useMemo(() => {
    const since = now - WEEK
    const recent = messages
      .filter((m) => {
        const t = new Date(m.created_at).getTime()
        return Number.isFinite(t) && t >= since
      })
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime() ||
          b.id - a.id,
      )
    const votes = recent.filter((m) => {
      const ref = pollRefOf(m.text ?? '')
      return !!ref && ref.kind === 'vote'
    })
    const places = recent.filter((m) =>
      PLACE_PLAN_LINE.test((m.text ?? '').split('\n').pop() ?? ''),
    )
    // 가장 최근에 올라온 투표 1개, 장소 선택 1개만 보여 준다
    return { votes: votes.slice(0, 1), places: places.slice(0, 1) }
  }, [messages, now])
}

/**
 * 투표 · 장소 선택 (민영이 디자인): 투표 → 장소 선택 순서로 세로로 쌓는다.
 * 채팅 오른쪽 칸(PC)과 모바일/태블릿의 접이식 한 줄 안에서 같이 쓴다.
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
  /** true 면 바깥 카드 테두리 없이 안쪽만 (접이식 안에서 사용) */
  bare?: boolean
}) {
  const { votes, places } = useActionMessages(messages)

  return (
    <section className={bare ? styles.bare : styles.actionSection}>
      <div className={styles.actionHeader}>
        <h2 className={styles.sideTitle}>투표 · 장소 선택</h2>
        <span className={styles.actionDescription}>가장 최근 항목</span>
      </div>

      <div className={styles.actionGrid}>
        <section className={styles.actionColumn}>
          <h3 className={styles.actionTitle}>
            <span>🗳 투표</span>
            <span className={styles.itemCount}>{votes.length}</span>
          </h3>
          {votes.length > 0 ? (
            <div className={styles.actionList}>
              {votes.map((m) => (
                <article key={m.id} className={styles.actionItem}>
                  <VoteMessage
                    text={m.text ?? ''}
                    groupId={groupId}
                    myUserId={myUserId}
                    onPost={onPost}
                  />
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.actionEmpty}>
              최근 일주일 동안 생성된 투표가 없어요.
            </div>
          )}
        </section>

        <section className={styles.actionColumn}>
          <h3 className={styles.actionTitle}>
            <span>📍 장소 선택</span>
            <span className={styles.itemCount}>{places.length}</span>
          </h3>
          {places.length > 0 ? (
            <div className={styles.actionList}>
              {places.map((m) => (
                <article key={m.id} className={styles.placeActionItem}>
                  <PlanMessage text={m.text ?? ''} groupId={groupId} />
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.actionEmpty}>
              최근 일주일 동안 추천된 장소가 없어요.
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
