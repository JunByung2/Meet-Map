'use client'

import { useState } from 'react'
import styles from './chat.module.css'

const TOOLS = ['MeetMode', '사진', '장소 선택', '약속 연결', '첨부']

export default function MessageComposer({
  sending,
  planning = false,
  status,
  onSend,
  onTool,
}: {
  sending: boolean
  planning?: boolean
  status: string
  onSend: (text: string) => Promise<boolean>
  onTool: (tool: string) => void
}) {
  const [text, setText] = useState('')

  async function submit() {
    if (!text.trim()) return
    const ok = await onSend(text)
    if (ok) setText('')
  }

  return (
    <section className={styles.composer}>
      <div className={styles.tools}>
        {TOOLS.map((tool) => (
          <button
            key={tool}
            type="button"
            className={styles.chip}
            disabled={tool === '장소 선택' && planning}
            onClick={() => onTool(tool)}
          >
            {tool}
          </button>
        ))}
      </div>

      <div className={styles.composerBottom}>
        <input
          className="input"
          type="text"
          value={text}
          placeholder="친구들에게 메시지 보내기"
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button
          type="button"
          className="btn"
          disabled={sending}
          onClick={submit}
        >
          ↑ 전송
        </button>
      </div>

      <p className={styles.hint}>Enter 키를 눌러 메시지를 보낼 수 있어요.</p>
      <div className={styles.status} role="status">
        {status}
      </div>
    </section>
  )
}
