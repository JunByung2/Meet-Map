'use client'

import { useState } from 'react'
import type { ChatMessage } from '@/hooks/useGroupMessages'
import ActionPanel, { useActionMessages } from './ActionPanel'
import styles from './shared.module.css'

/**
 * 모바일·태블릿 채팅 위쪽: "투표 · 장소 선택"을 한 줄로 접어 두고, 누르면 채팅 위에 덮어서
 * 민영이 디자인(투표 → 장소 선택)을 보여 준다. 채팅 높이는 그대로, PC 에서는 보이지 않는다.
 */
export default function SharedBar({
  messages,
  groupId,
  myUserId,
  onPost,
}: {
  messages: ChatMessage[]
  groupId: number
  myUserId: number
  onPost: (text: string) => Promise<unknown> | void
}) {
  const [open, setOpen] = useState(false)
  const { votes, places } = useActionMessages(messages)

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.bar}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.label}>투표 · 장소 선택</span>
        <span className={styles.badges}>
          <span className={styles.badge}>투표 {votes.length}</span>
          <span className={styles.badge}>장소 {places.length}</span>
        </span>
        <span className={styles.chev} aria-hidden>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className={styles.panel}>
          <ActionPanel
            bare
            messages={messages}
            groupId={groupId}
            myUserId={myUserId}
            onPost={onPost}
          />
        </div>
      )}
    </div>
  )
}
