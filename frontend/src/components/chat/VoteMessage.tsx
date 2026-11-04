'use client'

import { useState } from 'react'
import VoteDialog from './VoteDialog'
import { formatWhen, useVotePoll } from './useVotePoll'
import styles from './vote.module.css'

const VOTE_LINE = /^(vote|voteresult):([0-9a-fA-F-]{8,40})$/

/** 채팅 메시지 마지막 줄이 `vote:번호`(투표 카드) 또는 `voteresult:번호`(종료 결과)이면 그 정보를, 아니면 null */
export function pollRefOf(text: string): { kind: 'vote' | 'result'; id: string } | null {
  const m = VOTE_LINE.exec(text.split('\n').pop() ?? '')
  return m ? { kind: m[1] === 'vote' ? 'vote' : 'result', id: m[2] } : null
}

/**
 * 채팅에 올라가는 투표 카드 (카톡 모양).
 * - 투표 카드: "Q. 제목 / 항목들 / 투표하러 가기 >" → 누르면 투표 창이 열린다
 * - 종료 결과: "투표가 종료되었습니다. / Q. 제목 / 1위 항목 / 투표결과 확인하기 >"
 */
export default function VoteMessage({
  text,
  groupId,
  myUserId,
  onPost,
}: {
  text: string
  groupId: number
  myUserId: number
  onPost?: (text: string) => Promise<unknown> | void
}) {
  const ref = pollRefOf(text)
  const lines = text.split('\n')
  const [open, setOpen] = useState(false)
  const { items } = useVotePoll(groupId, ref?.id ?? '', ref?.kind === 'vote')

  if (!ref) return <>{text}</>

  if (ref.kind === 'result') {
    const title = (lines.find((l) => l.startsWith('🗳')) ?? '').replace(/^🗳\s*/, '') || '투표'
    const winner = (lines.find((l) => l.startsWith('🏆')) ?? '').replace(/^🏆\s*/, '')
    return (
      <>
        <div className={`${styles.card} ${styles.cardResult}`}>
          <span className={`${styles.tag} ${styles.tagDone}`}>🏆 투표가 종료되었어요</span>
          <strong className={styles.q}>{title}</strong>
          <div className={styles.winBox}>
            <span className={styles.rank}>1위 · 약속 확정</span>
            <strong className={styles.winnerName}>{winner}</strong>
          </div>
          <button type="button" className={`${styles.cta} ${styles.ctaGhost}`} onClick={() => setOpen(true)}>
            결과 자세히 보기
          </button>
        </div>
        {open && (
          <VoteDialog groupId={groupId} pollId={ref.id} title={title} myUserId={myUserId} onClose={() => setOpen(false)} onPost={onPost} />
        )}
      </>
    )
  }

  const title = lines.slice(0, -1).join('\n').replace(/^🗳\s*/, '') || '투표'
  return (
    <>
      <div className={styles.card}>
        <span className={styles.tag}>🗳 약속 투표</span>
        <strong className={styles.q}>{title}</strong>
        <ul className={styles.plain}>
          {(items ?? []).map((c) => (
            <li key={c.id}>
              📍 {c.location}
              <small>📅 {formatWhen(c.meeting_time)}</small>
            </li>
          ))}
          {items === null && <li className={styles.sub}>불러오는 중…</li>}
        </ul>
        <button type="button" className={styles.cta} onClick={() => setOpen(true)}>
          {items?.some((c) => c.closed) ? '투표 결과 보기' : '투표 참여하기'}
        </button>
      </div>
      {open && (
        <VoteDialog groupId={groupId} pollId={ref.id} title={title} myUserId={myUserId} onClose={() => setOpen(false)} onPost={onPost} />
      )}
    </>
  )
}
