'use client'

import { useRef, useState } from 'react'
import styles from './chat.module.css'

const TOOLS = ['MeetMode', '사진', '장소 선택', '투표', '약속 연결', '첨부']

export default function MessageComposer({
  sending,
  planning = false,
  status,
  onSend,
  onTool,
  onFile,
}: {
  sending: boolean
  planning?: boolean
  status: string
  onSend: (text: string) => Promise<boolean>
  onTool: (tool: string) => void
  /** 사진/첨부 파일을 골랐을 때 */
  onFile?: (kind: 'image' | 'file', file: File) => Promise<unknown> | void
}) {
  const [text, setText] = useState('')
  const imageRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function pick(kind: 'image' | 'file', input: HTMLInputElement) {
    const f = input.files?.[0]
    input.value = '' // 같은 파일을 다시 골라도 동작하게
    if (f) void onFile?.(kind, f)
  }

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
            onClick={() => {
              if (tool === '사진') imageRef.current?.click()
              else if (tool === '첨부') fileRef.current?.click()
              else onTool(tool)
            }}
          >
            {tool}
          </button>
        ))}
      </div>

      <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,.heic" hidden onChange={(e) => pick('image', e.target)} />
      <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.hwpx,.txt,.csv,.md,.zip" hidden onChange={(e) => pick('file', e.target)} />

      <div className={styles.composerBottom}>
        <input
          className="input ime-ko"
          lang="ko"
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
          className={`btn ${styles.send}`}
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
