'use client'

import { useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { formatWhen, useVotePoll, type Candidate } from './useVotePoll'
import styles from './vote.module.css'

/** 투표 종료 후 채팅방에 올라가는 결과 메시지 (마지막 줄이 voteresult:투표번호) */
export function resultText(title: string, winner: Candidate, pollId: string) {
  return `투표가 종료되었습니다.\n🗳 ${title}\n🏆 ${winner.location}\nvoteresult:${pollId}`
}

/**
 * 카톡처럼 "투표하러 가기"를 누르면 열리는 투표 창.
 * - 아직 안 했으면: 항목을 고르고 [투표하기]
 * - 했으면: 항목별 득표 막대 + [다시 투표하기] (+ 만든 사람은 [투표 종료])
 * - [투표 종료] → "종료하시겠습니까?" 확인 → 확정된 항목을 채팅방에 올린다
 */
export default function VoteDialog({
  groupId,
  pollId,
  title,
  myUserId,
  onClose,
  onPost,
}: {
  groupId: number
  pollId: string
  title: string
  myUserId: number
  onClose: () => void
  onPost?: (text: string) => Promise<unknown> | void
}) {
  const { items, reload } = useVotePoll(groupId, pollId)
  const [picking, setPicking] = useState(false) // 다시 투표하기 상태
  const [selected, setSelected] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [tiePick, setTiePick] = useState<number | null>(null)
  const [openId, setOpenId] = useState<number | null>(null) // 투표한 멤버를 펼쳐 보는 항목
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const closed = !!items?.some((c) => c.closed)
  const isCreator = !!items?.some((c) => c.created_by === myUserId)
  const voted = !!items?.some((c) => c.voted_by_me)
  const total = items?.reduce((n, c) => n + c.vote_count, 0) ?? 0
  const top = Math.max(0, ...(items ?? []).map((c) => c.vote_count))
  const leaders = (items ?? []).filter((c) => top > 0 && c.vote_count === top)
  const showPick = !closed && (!voted || picking)

  async function submitVote() {
    if (selected == null) return
    setBusy(true)
    setMsg('')
    try {
      await api(`/groups/${groupId}/meeting-candidates/${selected}/vote`, { method: 'POST' })
      await reload()
      setPicking(false)
      setSelected(null)
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : '투표에 실패했어요.')
    } finally {
      setBusy(false)
    }
  }

  async function endVote() {
    const winnerId = leaders.length === 1 ? leaders[0].id : tiePick
    const winner = items?.find((c) => c.id === winnerId)
    if (!winner) return
    setBusy(true)
    setMsg('')
    try {
      await api(`/groups/${groupId}/meeting-candidates/${winner.id}/confirm?resolve_tie=true`, { method: 'POST' })
      await onPost?.(resultText(title, winner, pollId))
      await reload()
      setConfirming(false)
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : '투표를 종료하지 못했어요.')
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="투표">
      <div className={`${styles.modal} ${styles.dlgModal}`}>
        <div className={styles.dlgHead}>
          <span className={`${styles.tag}${closed ? ` ${styles.tagDone}` : ''}`}>
            {closed ? '🏆 투표가 종료되었어요' : '🗳 투표 진행 중'}
          </span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <h3 className={styles.dlgTitle}>{title}</h3>

        {items === null && <p className={styles.sub}>불러오는 중…</p>}
        {items && items.length === 0 && <p className={styles.sub}>삭제되었거나 찾을 수 없는 투표예요.</p>}

        {items && items.length > 0 && showPick && (
          <>
            <ul className={styles.opts}>
              {items.map((c) => (
                <li key={c.id}>
                  <label className={`${styles.opt}${selected === c.id ? ` ${styles.optSel}` : ''}`}>
                    <input type="radio" name={`poll-${pollId}`} checked={selected === c.id} onChange={() => setSelected(c.id)} />
                    <span className={styles.dot} aria-hidden />
                    <span className={styles.optText}>
                      <b>📍 {c.location}</b>
                      <span className={styles.optMeta}>📅 {formatWhen(c.meeting_time)}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <button type="button" className={styles.primary} disabled={selected == null || busy} onClick={submitVote}>
              투표하기
            </button>
          </>
        )}

        {items && items.length > 0 && !showPick && (
          <>
            <ul className={styles.opts}>
              {items.map((c) => {
                const pct = total > 0 ? Math.round((c.vote_count / total) * 100) : 0
                const people = c.voters ?? []
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={`${styles.res}${c.chosen ? ` ${styles.resWin}` : ''}`}
                      onClick={() => setOpenId(openId === c.id ? null : c.id)}
                      aria-expanded={openId === c.id}
                    >
                      <div className={styles.resFill} style={{ width: `${pct}%` }} aria-hidden />
                      <div className={styles.resBody}>
                        <span className={styles.optText}>
                          <b>📍 {c.location}</b>
                          <span className={styles.optMeta}>📅 {formatWhen(c.meeting_time)}</span>
                        </span>
                        <span className={styles.resSide}>
                          <span className={styles.resCount}>{c.vote_count}명 {openId === c.id ? '▴' : '▾'}</span>
                          {c.chosen && <span className={styles.badge}>확정</span>}
                          {!c.chosen && c.voted_by_me && <span className={styles.badge}>내 선택</span>}
                        </span>
                      </div>
                    </button>
                    {openId === c.id && (
                      <div className={styles.voters}>
                        {people.length === 0 ? (
                          <span className={styles.sub}>아직 투표한 멤버가 없어요.</span>
                        ) : (
                          people.map((v) => (
                            <span key={v.user_id} className={styles.voter}>
                              {v.nickname}
                              {v.user_id === myUserId ? ' (나)' : ''}
                            </span>
                          ))
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>

            {!closed && (
              <div className={styles.btnRow}>
                <button type="button" className={styles.secondary} disabled={busy} onClick={() => setPicking(true)}>
                  다시 투표하기
                </button>
                {isCreator && (
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={busy}
                    onClick={() => {
                      if (total === 0) return setMsg('투표한 사람이 없어서 종료할 수 없어요.')
                      setMsg('')
                      setTiePick(null)
                      setConfirming(true)
                    }}
                  >
                    투표 종료
                  </button>
                )}
              </div>
            )}
            <p className={styles.people}>{total}명 참여</p>
          </>
        )}

        {msg && <p className={styles.msg}>{msg}</p>}
      </div>

      {confirming && (
        <div className={styles.overlay} role="alertdialog" aria-modal="true" aria-label="투표 종료 확인">
          <div className={styles.popup}>
            <p className={styles.popupTitle}>종료하시겠습니까?</p>
            {leaders.length > 1 ? (
              <>
                <p className={styles.sub}>동률이에요. 확정할 항목을 골라 주세요.</p>
                <ul className={styles.opts}>
                  {leaders.map((c) => (
                    <li key={c.id}>
                      <label className={`${styles.opt}${tiePick === c.id ? ` ${styles.optSel}` : ''}`}>
                        <input type="radio" name="tie" checked={tiePick === c.id} onChange={() => setTiePick(c.id)} />
                        <span className={styles.dot} aria-hidden />
                        <span className={styles.optText}>
                          <b>📍 {c.location}</b>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className={styles.sub}>1위 항목 &lsquo;{leaders[0]?.location}&rsquo; 으로 약속이 확정돼요.</p>
            )}
            <div className={styles.btnRow} style={{ marginTop: 14 }}>
              <button type="button" className={styles.secondary} disabled={busy} onClick={() => setConfirming(false)}>
                취소
              </button>
              <button
                type="button"
                className={styles.primary}
                disabled={busy || (leaders.length > 1 && tiePick == null)}
                onClick={endVote}
              >
                종료
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
