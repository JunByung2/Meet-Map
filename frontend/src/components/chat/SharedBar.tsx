'use client'

import { useState } from 'react'
import type { ChatMessage } from '@/hooks/useGroupMessages'
import ActionPanel, { useActionMessages } from './ActionPanel'
import styles from './shared.module.css'

/**
 * 모바일·태블릿 채팅 위쪽: 투표 목록을 접어 두고, 누르면 채팅 위에 표시한다.
 * 채팅 높이는 그대로, PC에서는 보이지 않는다.
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
  const { votes } = useActionMessages(messages)

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.bar}
        aria-expanded={open}
        aria-label={`투표 ${votes.length}개 ${open ? '닫기' : '열기'}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.label}>투표</span>
        <span className={styles.badges}>
          <span className={styles.badge}>투표 {votes.length}</span>
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
