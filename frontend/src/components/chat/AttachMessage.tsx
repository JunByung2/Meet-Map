'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import styles from './attach.module.css'

const ATTACH_LINE = /^attach:(\d{1,12})$/

/** 채팅 메시지 마지막 줄이 `attach:번호` 이면 첨부(사진/파일) 번호를, 아니면 null */
export function attachRefOf(text: string): number | null {
  const m = ATTACH_LINE.exec(text.split('\n').pop() ?? '')
  return m ? Number(m[1]) : null
}

type Attachment = {
  id: number
  kind: 'image' | 'file'
  filename: string
  content_type: string
  size: number
  signed_url: string | null
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

export default function AttachMessage({ text, groupId }: { text: string; groupId: number }) {
  const id = attachRefOf(text)
  const [info, setInfo] = useState<Attachment | null>(null)
  const [gone, setGone] = useState(false)
  const [ask, setAsk] = useState(false)
  const [big, setBig] = useState(false)

  useEffect(() => {
    if (id === null) return
    let alive = true
    api<Attachment>(`/groups/${groupId}/chat-files/${id}`)
      .then((a) => alive && setInfo(a))
      .catch(() => alive && setGone(true))
    return () => {
      alive = false
    }
  }, [groupId, id])

  if (id === null) return null
  if (gone) return <div className={styles.gone}>삭제되었거나 볼 수 없는 첨부예요.</div>
  if (!info) return <div className={styles.gone}>불러오는 중…</div>

  const downloadUrl = `/api/groups/${groupId}/chat-files/${id}/download`

  function download() {
    setAsk(false)
    const a = document.createElement('a')
    a.href = downloadUrl
    a.download = info?.filename ?? ''
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <>
      {info.kind === 'image' && info.signed_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.img} src={info.signed_url} alt={info.filename} onClick={() => setBig(true)} />
      ) : (
        <button type="button" className={styles.file} onClick={() => setAsk(true)}>
          <span className={styles.icon}>📄</span>
          <span className={styles.meta}>
            <strong>{info.filename}</strong>
            <small>{formatSize(info.size)} · 눌러서 내려받기</small>
          </span>
        </button>
      )}

      {ask && (
        <div className={styles.overlay} role="dialog" aria-modal="true" onClick={() => setAsk(false)}>
          <div className={styles.dlg} onClick={(e) => e.stopPropagation()}>
            <h3>다운로드하시겠습니까?</h3>
            <p>{info.filename} ({formatSize(info.size)})</p>
            <div className={styles.btns}>
              <button type="button" className="btn secondary sm" onClick={() => setAsk(false)}>취소</button>
              <button type="button" className="btn sm" onClick={download}>동의</button>
            </div>
          </div>
        </div>
      )}

      {big && info.signed_url && (
        <div className={styles.overlay} onClick={() => setBig(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.big} src={info.signed_url} alt={info.filename} />
        </div>
      )}
    </>
  )
}
