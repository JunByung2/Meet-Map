"use client";

import { Fragment, useEffect, useRef, useState } from 'react'
import Avatar from '@/components/Avatar'
import type { ChatMessage } from '@/hooks/useGroupMessages'
import styles from './chat.module.css'
import sel from './chatSelect.module.css'
import PlanMessage from '@/features/recommendation/PlanMessage'
import VoteMessage, { pollRefOf } from './VoteMessage'
import AttachMessage, { attachRefOf, attachRefsOf } from './AttachMessage'
import { formatDateBand } from '@/lib/records'

function formatTime(dateString: string | null | undefined) {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// 한국 시간 기준 날짜 (YYYY-MM-DD)
function dayKey(dateString: string | null | undefined) {
  if (!dateString) return ''
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

// Remember which messages are on screen and where, so the view can stay put after a delete.
type Anchor = { id: number; offset: number }
function captureAnchors(box: HTMLElement, store: { current: Anchor[] }) {
  const top = box.getBoundingClientRect().top
  const list: Anchor[] = []
  for (const el of Array.from(box.querySelectorAll<HTMLElement>('[data-mid]'))) {
    const r = el.getBoundingClientRect()
    if (r.bottom <= top) continue
    if (r.top > top + box.clientHeight) break
    list.push({ id: Number(el.dataset.mid), offset: r.top - top })
    if (list.length >= 40) break
  }
  store.current = list
}

export default function MessageList({
  messages,
  loading,
  myUserId,
  nameOf,
  imageOf,
  onPost,
  focusDate,
  onDelete,
  canDeleteAll = false,
  onLoadOlder,
  hasMore = false,
  loadingOlder = false,
  selectMode = false,
  selectedIds,
  onToggleSelect,
  selectedPhotos,
  onTogglePhoto,
}: {
  messages: ChatMessage[]
  loading: boolean
  myUserId: number
  nameOf: (userId: number) => string
  imageOf?: (userId: number) => string | null
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
  /** 여러 개 골라서 지우는 중 (골라진 번호들과 눌렀을 때 호출) */
  selectMode?: boolean
  selectedIds?: Set<number>
  onToggleSelect?: (id: number) => void
  /** 묶음 사진에서 따로 고른 사진들 (말풍선 번호 → 첨부 번호들) 과 한 장 고르기 */
  selectedPhotos?: Map<number, Set<number>>
  onTogglePhoto?: (messageId: number, attId: number, allIds: number[]) => void
}) {
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const boxRef = useRef<HTMLElement>(null)
  const focused = useRef(false)
  const nearBottom = useRef(true)
  const lastSeen = useRef<number | null>(null) // last message id seen by the scroll effect
  const anchors = useRef<Anchor[]>([])
  const snapping = useRef(false)
  const prepending = useRef<number | null>(null) // 이전 대화를 위에 붙이기 직전의 scrollHeight

  useEffect(() => {
    const box = boxRef.current
    if (messages.length === 0) lastSeen.current = null
    if (!box || messages.length === 0) return
    const lastId = messages[messages.length - 1].id
    const prevLast = lastSeen.current
    lastSeen.current = lastId
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
    if (prevLast !== null && lastId <= prevLast) {
      // delete or partial delete: no new message, so keep the place the user was looking at
      const top = box.getBoundingClientRect().top
      for (const a of anchors.current) {
        const el = box.querySelector<HTMLElement>('[data-mid="' + a.id + '"]')
        if (el) {
          box.scrollTop += el.getBoundingClientRect().top - top - a.offset
          break
        }
      }
      captureAnchors(box, anchors)
      return
    }
    if (!focusDate || nearBottom.current) box.scrollTop = box.scrollHeight
    captureAnchors(box, anchors)
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
    if (box && !snapping.current) {
      snapping.current = true
      window.requestAnimationFrame(() => {
        snapping.current = false
        captureAnchors(box, anchors)
      })
    }
  }

  if (loading || messages.length === 0) {
    return (
      <section className={styles.messages} ref={boxRef} aria-live="polite">
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>☘</div>
          <strong>
            {loading
              ? "메시지를 불러오는 중이에요."
              : "아직 메시지가 없어요. 첫 이야기를 남겨 보세요."}
          </strong>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.messages} ref={boxRef} onScroll={onScroll} aria-live="polite">
      {onLoadOlder && hasMore && (
        <button type="button" className={styles.olderBtn} onClick={() => void loadOlder()} disabled={loadingOlder}>
          {loadingOlder ? '불러오는 중…' : '↑ 이전 대화 더 보기'}
        </button>
      )}
      {messages.map((m, i) => {
        const senderId = Number(m.user_id)
        const isMine = senderId === myUserId
        const sender = nameOf(Number(m.user_id))

        const day = dayKey(m.created_at)
        const showBand = day !== '' && day !== dayKey(messages[i - 1]?.created_at)
        const isPoll = !!pollRefOf(m.text ?? '')
        const isAttach = attachRefOf(m.text ?? '') !== null
        const canDelete = !!onDelete && (isMine || canDeleteAll)
        const picking = selectMode && !!onToggleSelect
        const picked = picking && !!selectedIds?.has(m.id)
        const isBundle = isAttach && attachRefsOf(m.text ?? '').length > 1
        const partPicked = picking && !picked && (selectedPhotos?.get(m.id)?.size ?? 0) > 0

        return (
          <Fragment key={m.id}>
          {showBand && (
            <div className={styles.dateBand} data-day={day}>
              {formatDateBand(day)}
            </div>
          )}
          <div
            data-mid={m.id}
            className={`${styles.row} ${isMine ? styles.mine : styles.other}${
              picking ? ` ${canDelete ? sel.pickable : sel.locked}` : ''
            }${picked || partPicked ? ` ${sel.picked}` : ''}`}
            onClick={picking && canDelete ? () => onToggleSelect?.(m.id) : undefined}
            onContextMenu={(e) => {
              if (picking || !canDelete) return
              e.preventDefault()
              setMenu({ id: m.id, x: e.clientX, y: e.clientY })
            }}
          >
            {picking && (
              <span className={`${sel.check}${picked ? ` ${sel.checkOn}` : partPicked ? ` ${sel.checkPart}` : ''}`} aria-hidden="true">
                {picked ? '✓' : partPicked ? '–' : ''}
              </span>
            )}
            {!isMine && <Avatar userId={senderId} name={sender}
              image={imageOf?.(senderId) ?? null} size="sm" />}
            <div className={`${styles.body}${isPoll ? ` ${styles.wideBody}` : ''}${picking && !isBundle ? ` ${sel.noClick}` : ''}`}>
              {!isMine && <div className={styles.sender}>{sender}</div>}
              <div className={`${styles.bubble}${isPoll || isAttach ? ` ${styles.bubbleBare}` : ''}`}>
                {isAttach ? (
                  <AttachMessage
                    text={m.text ?? ''}
                    groupId={Number(m.group_id)}
                    viewerTitle={`${sender} ${day}`}
                    pick={
                      picking && isBundle
                        ? {
                            whole: picked,
                            picked: selectedPhotos?.get(m.id) ?? new Set<number>(),
                            canEdit: canDelete,
                            onToggle: (attId, allIds) => onTogglePhoto?.(m.id, attId, allIds),
                          }
                        : undefined
                    }
                  />
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
                {canDelete && !picking && (
                  <button type="button" className={styles.delBtn} onClick={() => setConfirmId(m.id)}>
                    삭제
                  </button>
                )}
              </div>
            </div>
            {isMine && (
              <Avatar
                userId={senderId}
                name={sender}
                image={imageOf?.(senderId) ?? null}
                size="sm"
              />
            )}
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
  );
}
