'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@/hooks/useGroupMessages'
import styles from './chat.module.css'
import PlanMessage from '@/features/recommendation/PlanMessage'
import VoteMessage, { pollRefOf } from './VoteMessage'
import AttachMessage, { attachRefOf } from './AttachMessage'
import { formatDateBand } from '@/lib/records'

function formatTime(dateString: string | null | undefined) {
  if (!dateString) return ''
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

// 한국 시간 기준 날짜 (YYYY-MM-DD)
function dayKey(dateString: string | null | undefined) {
  if (!dateString) return ''
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

export default function MessageList({
  messages,
  loading,
  myUserId,
  nameOf,
  onPost,
  focusDate,
  onDelete,
  canDeleteAll = false,
  onLoadOlder,
  hasMore = false,
  loadingOlder = false,
}: {
  messages: ChatMessage[]
  loading: boolean
  myUserId: number
  nameOf: (userId: number) => string
  /** 투표 종료 결과처럼 카드에서 채팅으로 글을 올릴 때 쓴다 (없으면 올리지 않음) */
  onPost?: (text: string) => Promise<unknown> | void
  /** 지난 기록에서 넘어왔을 때: 이 날짜(YYYY-MM-DD)의 첫 대화로 스크롤한다 */
  focusDate?: string
  /** 메시지 삭제 (내 메시지, 방장은 모두). 없으면 삭제 메뉴를 보이지 않음 */
  onDelete?: (id: number) => Promise<unknown> | void
  canDeleteAll?: boolean
  /** 위쪽 "이전 대화 더 보기" 버튼 (없으면 버튼을 보이지 않음) */
  onLoadOlder?: () => Promise<unknown> | void
  hasMore?: boolean
  loadingOlder?: boolean
}) {
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const boxRef = useRef<HTMLElement>(null)
  const focused = useRef(false)
  const nearBottom = useRef(true)
  const prepending = useRef<number | null>(null) // 이전 대화를 위에 붙이기 직전의 scrollHeight

  useEffect(() => {
    const box = boxRef.current
    if (!box || messages.length === 0) return
    if (prepending.current !== null) {
      // 이전 대화가 위에 붙었으면 보고 있던 자리를 그대로 유지한다
      box.scrollTop = box.scrollHeight - prepending.current
      prepending.current = null
      return
    }
    if (focusDate && !focused.current) {
      // 그 날짜(없으면 그 이후 첫 날짜)의 날짜 띠를 찾아 맨 위로 맞춘다
      const bands = Array.from(box.querySelectorAll<HTMLElement>('[data-day]'))
      const target = bands.find((b) => (b.dataset.day ?? '') >= focusDate) ?? bands[bands.length - 1]
      if (target) {
        box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top - 4
      }
      focused.current = true
      nearBottom.current = false
      return
    }
    // 날짜 이동 중에 위에서 읽고 있으면 새 메시지가 와도 끌어내리지 않는다
    if (!focusDate || nearBottom.current) box.scrollTop = box.scrollHeight
  }, [messages, focusDate])

  async function loadOlder() {
    prepending.current = boxRef.current?.scrollHeight ?? null
    await onLoadOlder?.()
    // 새로 붙은 게 없으면 위치 보정이 필요 없다
    window.setTimeout(() => {
      prepending.current = null
    }, 0)
  }

  function onScroll() {
    const box = boxRef.current
    if (box) nearBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80
  }

  if (loading || messages.length === 0) {
    return (
      <section className={styles.messages} ref={boxRef} aria-live="polite">
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>☘</div>
          <strong>
            {loading
              ? '메시지를 불러오는 중이에요.'
              : '아직 메시지가 없어요. 첫 이야기를 남겨 보세요.'}
          </strong>
        </div>
      </section>
    )
  }

  return (
    <section className={styles.messages} ref={boxRef} onScroll={onScroll} aria-live="polite">
      {onLoadOlder && hasMore && (
        <button type="button" className={styles.olderBtn} onClick={() => void loadOlder()} disabled={loadingOlder}>
          {loadingOlder ? '불러오는 중…' : '↑ 이전 대화 더 보기'}
        </button>
      )}
      {messages.map((m, i) => {
        const isMine = Number(m.user_id) === myUserId
        const sender = nameOf(Number(m.user_id))

        const day = dayKey(m.created_at)
        const showBand = day !== '' && day !== dayKey(messages[i - 1]?.created_at)
        const isPoll = !!pollRefOf(m.text ?? '')
        const isAttach = attachRefOf(m.text ?? '') !== null
        const canDelete = !!onDelete && (isMine || canDeleteAll)

        return (
          <Fragment key={m.id}>
          {showBand && (
            <div className={styles.dateBand} data-day={day}>
              {formatDateBand(day)}
            </div>
          )}
          <div
            className={`${styles.row} ${isMine ? styles.mine : styles.other}`}
            onContextMenu={(e) => {
              if (!canDelete) return
              e.preventDefault()
              setMenu({ id: m.id, x: e.clientX, y: e.clientY })
            }}
          >
            {!isMine && <span className="avatar sm">{sender.slice(0, 1)}</span>}
            <div className={`${styles.body}${isPoll ? ` ${styles.wideBody}` : ''}`}>
              {!isMine && <div className={styles.sender}>{sender}</div>}
              <div className={`${styles.bubble}${isPoll || isAttach ? ` ${styles.bubbleBare}` : ''}`}>
                {isAttach ? (
                  <AttachMessage text={m.text ?? ''} groupId={Number(m.group_id)} />
                ) : pollRefOf(m.text ?? '') ? (
                  <VoteMessage
                    text={m.text ?? ''}
                    groupId={Number(m.group_id)}
                    myUserId={myUserId}
                    onPost={onPost}
                  />
                ) : (
                  <PlanMessage text={m.text ?? ''} groupId={m.group_id} />
                )}
              </div>
              <div className={styles.time}>
                {formatTime(m.created_at)}
                {canDelete && (
                  <button type="button" className={styles.delBtn} onClick={() => setConfirmId(m.id)}>
                    삭제
                  </button>
                )}
              </div>
            </div>
            {isMine && <span className="avatar sm">{sender.slice(0, 1)}</span>}
          </div>
          </Fragment>
        )
      })}
      {menu && (
        <>
          <div className={styles.menuBack} onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div className={styles.menu} style={{ left: menu.x, top: menu.y }}>
            <button type="button" onClick={() => { setConfirmId(menu.id); setMenu(null) }}>🗑 삭제</button>
          </div>
        </>
      )}
      {confirmId !== null && (
        <div className={styles.confirmBack} role="dialog" aria-modal="true" onClick={() => setConfirmId(null)}>
          <div className={styles.confirm} onClick={(e) => e.stopPropagation()}>
            <h3>메시지를 삭제할까요?</h3>
            <p>삭제하면 모두에게서 사라져요. 투표나 투표 결과를 지워도 확정된 약속·지난 기록은 그대로 남아요.</p>
            <div className={styles.confirmBtns}>
              <button type="button" className="btn secondary sm" onClick={() => setConfirmId(null)}>취소</button>
              <button
                type="button"
                className="btn sm"
                onClick={() => { const id = confirmId; setConfirmId(null); void onDelete?.(id) }}
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
