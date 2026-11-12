'use client'

import { useEffect, useRef, useState, type ClipboardEvent } from 'react'
import styles from './chat.module.css'
import tray from './bundle.module.css'
import { hasAllowedExtension } from '@/lib/photos'

const TOOLS = ['MeetMode', '첨부', '장소 선택', '투표'] // 첨부 안에 사진과 문서·파일이 들어 있다
const MAX_PHOTOS = 27 // 한 번에 보낼 수 있는 사진 수 (9장씩 3묶음)
const BUNDLE_KEY = 'meetmap.chat.bundlePhotos' // '묶어서 보내기' 선택을 기억한다 (다음에도 그대로)

function readBundlePref(): boolean {
  try {
    return window.localStorage.getItem(BUNDLE_KEY) !== 'off' // 처음에는 켜져 있다
  } catch {
    return true
  }
}

export default function MessageComposer({
  sending,
  planning = false,
  status,
  onSend,
  onTool,
  onFile,
  onFiles,
  onSelectMode,
  canSelect = true,
}: {
  sending: boolean
  planning?: boolean
  status: string
  onSend: (text: string) => Promise<boolean>
  onTool: (tool: string) => void
  /** 사진/첨부 파일을 골랐을 때 */
  onFile?: (kind: 'image' | 'file', file: File) => Promise<unknown> | void
  /** 사진을 여러 장 골랐을 때 (있으면 onFile 대신 쓴다) */
  onFiles?: (
    kind: 'image' | 'file',
    files: File[],
    opts?: { bundle?: boolean },
  ) => Promise<unknown> | void
  /** select-delete chip handler (shown next to the option chips) */
  onSelectMode?: () => void
  /** false disables the chip (no messages) */
  canSelect?: boolean
}) {
  const [text, setText] = useState('')
  const imageRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [attachOpen, setAttachOpen] = useState(false) // 첨부를 누르면 사진 / 문서·파일 중에 고른다

  // 보내기 전 사진 미리보기 (2장 이상 골랐을 때)
  const [pending, setPending] = useState<
    { id: string; file: File; url: string }[]
  >([])
  const [bundle, setBundle] = useState(true)
  const [note, setNote] = useState('')
  const pendingRef = useRef(pending)
  useEffect(() => {
    pendingRef.current = pending
  }, [pending])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBundle(readBundlePref())
  }, [])

  // 화면을 떠날 때 미리보기용 임시 주소를 정리한다
  useEffect(
    () => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.url)),
    [],
  )

  function toggleBundle() {
    setBundle((cur) => {
      const next = !cur
      try {
        window.localStorage.setItem(BUNDLE_KEY, next ? 'on' : 'off')
      } catch {
        /* 저장할 수 없어도 이번에는 그대로 동작한다 */
      }
      return next
    })
  }

  function clearPending() {
    pending.forEach((p) => URL.revokeObjectURL(p.url))
    setPending([])
    setNote('')
  }

  function removePending(id: string) {
    setPending((cur) => {
      const gone = cur.find((p) => p.id === id)
      if (gone) URL.revokeObjectURL(gone.url)
      return cur.filter((p) => p.id !== id)
    })
  }

  function sendPending() {
    const files = pending.map((p) => p.file)
    pending.forEach((p) => URL.revokeObjectURL(p.url))
    setPending([])
    setNote('')
    if (onFiles) void onFiles('image', files, { bundle })
    else files.forEach((f) => void onFile?.('image', f))
  }

  function pick(kind: 'image' | 'file', input: HTMLInputElement) {
    let files = Array.from(input.files ?? [])
    let dropped = false
    input.value = '' // 같은 파일을 다시 골라도 동작하게
    if (files.length === 0) return
    if (kind === 'image') {
      // accept="image/*" 로 모바일에서 사진 선택 화면이 한결같이 뜨게 하는 대신, 서버가 받는 사진(JPG·PNG·WEBP·HEIC)만 남긴다
      const okFiles = files.filter((f) => hasAllowedExtension(f))
      dropped = okFiles.length < files.length
      if (dropped) setNote('JPG, PNG, WEBP, HEIC 사진만 보낼 수 있어요. 다른 형식은 뺐어요.')
      files = okFiles
      if (files.length === 0) return
    }
    if (kind === 'file') {
      if (onFiles) void onFiles(kind, files)
      else void onFile?.(kind, files[0])
      return
    }
    // 사진 한 장은 바로 보내고 (예전과 같게), 여러 장이면 미리보기에서 묶을지 고른다
    if (files.length === 1 && pending.length === 0) {
      if (onFiles) void onFiles(kind, files)
      else void onFile?.(kind, files[0])
      return
    }
    const room = MAX_PHOTOS - pending.length
    if (files.length > room)
      setNote(`한 번에 최대 ${MAX_PHOTOS}장까지 보낼 수 있어요.`)
    else setNote(dropped ? 'JPG, PNG, WEBP, HEIC 사진만 보낼 수 있어요. 다른 형식은 뺐어요.' : '')
    setPending((cur) => [
      ...cur,
      ...files
        .slice(0, Math.max(room, 0))
        .map((file) => ({
          id: crypto.randomUUID(),
          file,
          url: URL.createObjectURL(file),
        })),
    ])
  }

  // 클립보드에 사진이 있으면 (복사한 사진, 스크린샷) 미리보기 칸에 담는다
  function onPaste(e: ClipboardEvent<HTMLElement>) {
    const files = Array.from(e.clipboardData.files).filter((f) =>
      f.type.startsWith('image/'),
    )
    if (files.length === 0) return // 글자만 붙여넣는 경우는 그대로 둔다
    e.preventDefault()
    const room = MAX_PHOTOS - pending.length
    if (files.length > room)
      setNote(`한 번에 최대 ${MAX_PHOTOS}장까지 보낼 수 있어요.`)
    else setNote('')
    setPending((cur) => [
      ...cur,
      ...files
        .slice(0, Math.max(room, 0))
        .map((file) => ({
          id: crypto.randomUUID(),
          file,
          url: URL.createObjectURL(file),
        })),
    ])
  }

  // 전송 버튼과 Enter 키는 하나로 동작한다: 미리보기에 사진이 있으면 사진을 먼저 보내고, 글자가 있으면 이어서 보낸다
  async function submit() {
    const hasPhotos = pending.length > 0
    const hasText = text.trim().length > 0
    if (!hasPhotos && !hasText) return
    if (hasPhotos) sendPending()
    if (hasText) {
      const ok = await onSend(text)
      if (ok) setText('')
    }
  }

  return (
    <section className={styles.composer} onPaste={onPaste}>
      <div className={styles.tools}>
        {TOOLS.map((tool) => (
          <button
            key={tool}
            type="button"
            className={`${styles.chip} ${tool === '첨부' && attachOpen ? styles.chipOn : ''}`}
            disabled={tool === '장소 선택' && planning}
            aria-expanded={tool === '첨부' ? attachOpen : undefined}
            onClick={() => {
              if (tool === '첨부') setAttachOpen((v) => !v)
              else {
                setAttachOpen(false)
                onTool(tool)
              }
            }}
          >
            {tool}
          </button>
        ))}
        {onSelectMode && (
          <button type="button" className={styles.chip} disabled={!canSelect} onClick={onSelectMode}>
            ☑ 선택 삭제
          </button>
        )}
      </div>

      {attachOpen && (
        <div className={styles.attachMenu}>
          <button
            type="button"
            onClick={() => {
              setAttachOpen(false)
              imageRef.current?.click()
            }}
          >
            🖼 사진
          </button>
          <button
            type="button"
            onClick={() => {
              setAttachOpen(false)
              fileRef.current?.click()
            }}
          >
            📄 문서·파일
          </button>
        </div>
      )}

      <input
        ref={imageRef}
        type="file"
        multiple
        accept="image/*"
        hidden
        onChange={(e) => pick('image', e.target)}
      />
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.hwpx,.txt,.csv,.md,.zip"
        hidden
        onChange={(e) => pick('file', e.target)}
      />

      {pending.length > 0 && (
        <div className={tray.tray} aria-label="보낼 사진 미리보기">
          <div className={tray.thumbs}>
            {pending.map((p) => (
              <div key={p.id} className={tray.thumb}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.file.name} />
                <button
                  type="button"
                  className={tray.thumbX}
                  aria-label="이 사진 빼기"
                  onClick={() => removePending(p.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className={tray.trayRow}>
            <span className={tray.count}>
              사진 {pending.length}장
              {pending.length > 9 && bundle ? ' (9장씩 묶여요)' : ''}
            </span>
            {pending.length > 1 && (
              <button
                type="button"
                className={tray.toggle}
                role="checkbox"
                aria-checked={bundle}
                onClick={toggleBundle}
              >
                <span
                  className={`${tray.circle}${bundle ? ` ${tray.circleOn}` : ''}`}
                  aria-hidden="true"
                >
                  {bundle ? '✓' : ''}
                </span>
                묶어서 보내기
              </button>
            )}
            <button
              type="button"
              className="btn secondary sm"
              onClick={clearPending}
            >
              취소
            </button>
          </div>
          {note && <p className={styles.hint}>{note}</p>}
        </div>
      )}

      <div className={styles.composerBottom}>
        <input
          className="input ime-ko"
          lang="ko"
          type="text"
          value={text}
          placeholder={
            pending.length > 0
              ? '사진과 함께 보낼 메시지 (없어도 돼요)'
              : '친구들에게 메시지 보내기'
          }
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

      <p className={styles.hint}>
        Enter 키를 눌러 메시지{pending.length > 0 ? '와 사진을' : '를'} 보낼 수
        있어요.
      </p>
      <div className={styles.status} role="status">
        {status}
      </div>
    </section>
  )
}
