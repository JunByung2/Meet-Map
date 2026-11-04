'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import styles from './attach.module.css'
import bundle from './bundle.module.css'
import { openPhotoViewer } from './photoViewerStore'
import { bubbleWidth, rowsOf, splitRows } from '@/lib/bundleLayout'

// 마지막 줄: attach:번호  또는  attach:1,2,3 (묶어서 보낸 사진)
const ATTACH_LINE = /^attach:(\d{1,12}(?:,\d{1,12})*)$/

/** 채팅 메시지 마지막 줄이 `attach:번호` 형식이면 첨부(사진/파일) 번호들을, 아니면 빈 목록 */
export function attachRefsOf(text: string): number[] {
  const m = ATTACH_LINE.exec(text.split('\n').pop() ?? '')
  return m ? m[1].split(',').map(Number) : []
}

/** 첨부가 하나인 메시지의 번호(묶음이면 첫 번째), 첨부가 아니면 null */
export function attachRefOf(text: string): number | null {
  const ids = attachRefsOf(text)
  return ids.length ? ids[0] : null
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

/** 여러 개 골라서 지우는 중, 묶음 사진을 한 장씩 고르기 위한 정보 */
export type PhotoPick = {
  whole: boolean // 말풍선 전체가 골라져 있음
  picked: Set<number> // 따로 고른 사진 번호들
  canEdit: boolean // 내가 지울 수 있는 말풍선인지
  onToggle: (attId: number, allIds: number[]) => void
}

export default function AttachMessage({
  text,
  groupId,
  pick,
  viewerTitle = '',
}: {
  text: string
  groupId: number
  pick?: PhotoPick
  /** 사진 팝업 창 제목 (보낸 사람 · 날짜) */
  viewerTitle?: string
}) {
  const ids = attachRefsOf(text)
  if (ids.length > 1) return <AttachBundle ids={ids} groupId={groupId} pick={pick} viewerTitle={viewerTitle} />
  return <AttachOne text={text} groupId={groupId} viewerTitle={viewerTitle} />
}

// 한 말풍선에 묶이는 사진 수는 최대 16장 (4x4). 그보다 많이 보내면 16장씩 나뉘어 여러 말풍선이 된다.
// 배치(줄마다 몇 장)는 lib/bundleLayout.ts 가 정한다.

/** 묶어서 보낸 사진: 한 말풍선에 격자로 보여 주고, 눌러서 크게 넘겨 본다 */
function AttachBundle({ ids, groupId, pick, viewerTitle }: { ids: number[]; groupId: number; pick?: PhotoPick; viewerTitle: string }) {
  // 첨부 번호 → 정보. 번호로 찾기 때문에, 사진이 지워져 말풍선의 번호가 줄어도 칸과 정보가 어긋나지 않는다
  const [byId, setById] = useState<Map<number, Attachment> | null>(null)
  const key = ids.join(',')

  useEffect(() => {
    let alive = true
    // 사진이 많아도 요청 한 번으로 정보와 임시 주소를 받는다
    api<Attachment[]>(`/groups/${groupId}/chat-files?ids=${ids.join(',')}`)
      .catch(() => [] as Attachment[])
      .then((list) => {
        if (!alive) return
        setById(new Map(list.map((a) => [a.id, a])))
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, key])

  const shown = ids.map((id) => byId?.get(id) ?? null)
  const urls = shown.map((a) => (a && a.kind === 'image' ? a.signed_url : null))
  const existing = ids.filter((_, i) => !!urls[i]) // 아직 남아 있는 사진 번호들

  // 눌러서 팝업 창으로 본다 (창은 하나뿐이고, 다른 사진을 누르면 그 창의 사진이 바뀐다)
  function view(i: number) {
    const list = shown
      .map((a, idx) => ({ a, idx }))
      .filter((x) => !!urls[x.idx])
      .map((x) => ({ id: ids[x.idx], name: x.a?.filename ?? '사진', url: urls[x.idx] as string }))
    const at = list.findIndex((p) => p.id === ids[i])
    openPhotoViewer(list, at < 0 ? 0 : at, viewerTitle, groupId)
  }

  const rows = rowsOf(ids.length)
  const cells = shown.map((a, i) =>
          urls[i] ? (
            <button
              type="button"
              key={ids[i]}
              className={bundle.cell}
              onClick={(e) => {
                if (pick) {
                  e.stopPropagation() // 말풍선 전체 선택이 아니라 이 사진만 고른다
                  if (pick.canEdit) pick.onToggle(ids[i], existing)
                } else view(i)
              }}
              aria-label={pick ? `사진 ${i + 1}번 선택` : `사진 ${i + 1}번 팝업으로 보기`}
              aria-pressed={pick ? pick.whole || pick.picked.has(ids[i]) : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={urls[i] as string} alt={a?.filename ?? '사진'} loading="lazy" decoding="async" />
              {pick && (
                <span className={`${bundle.pick}${pick.whole || pick.picked.has(ids[i]) ? ` ${bundle.pickOn}` : ''}${pick.canEdit ? '' : ` ${bundle.pickOff}`}`}>
                  {pick.whole || pick.picked.has(ids[i]) ? '✓' : ''}
                </span>
              )}
            </button>
          ) : (
            <div key={ids[i]} className={`${bundle.cell} ${bundle.cellGone}`}>
              {byId === null ? '불러오는 중…' : '삭제된 사진'}
            </div>
          ),
  )

  return (
    <>
      <div className={bundle.mosaic} style={{ width: bubbleWidth(rows) }}>
        {splitRows(cells, rows).map((row, r) => (
          <div className={bundle.mrow} key={r}>
            {row}
          </div>
        ))}
      </div>

    </>
  )
}

function AttachOne({ text, groupId, viewerTitle }: { text: string; groupId: number; viewerTitle: string }) {
  const id = attachRefOf(text)
  const [info, setInfo] = useState<Attachment | null>(null)
  const [gone, setGone] = useState(false)
  const [ask, setAsk] = useState(false)

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
        <img className={styles.img} src={info.signed_url} alt={info.filename} onClick={() => openPhotoViewer([{ id: info.id, name: info.filename, url: info.signed_url as string }], 0, viewerTitle, groupId)} />
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

    </>
  )
}
