'use client'

import { useState } from 'react'
import { api, ApiError } from '@/lib/api'
import type { PlaceValue } from '@/lib/photos'
import { usePlaceSearch } from '@/lib/usePlaceSearch'
import DateTimePicker from './DateTimePicker'
import styles from './vote.module.css'

type Option = { key: number; place: PlaceValue | null; when: string }

const MIN_OPTIONS = 2
const MAX_OPTIONS = 6

let nextKey = 1
const blank = (): Option => ({ key: nextKey++, place: null, when: '' })

function formatWhen(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

/** 항목 한 줄: 장소는 카카오 검색으로만 고르고, 맨 오른쪽 달력 아이콘으로 날짜·시간을 고른다. */
function OptionRow({
  index,
  option,
  removable,
  onChange,
  onRemove,
}: {
  index: number
  option: Option
  removable: boolean
  onChange: (patch: Partial<Option>) => void
  onRemove: () => void
}) {
  const search = usePlaceSearch()
  const [pickOpen, setPickOpen] = useState(false)
  const [changing, setChanging] = useState(false) // 이미 고른 장소를 다시 검색하는 중
  const searching = !option.place || changing

  // 고른 장소를 바꾸고 싶을 때: 이전 이름으로 바로 검색해 보여 준다 (취소하면 원래 장소가 그대로 남는다)
  function startChange() {
    const prev = option.place?.name ?? ''
    search.setKeyword(prev)
    setChanging(true)
    if (prev) void search.run(prev)
  }

  function stopChange() {
    setChanging(false)
    search.clear()
    search.setKeyword('')
  }

  return (
    <div className={styles.row}>
      <div className={styles.rowLine}>
        {!searching && option.place ? (
          <>
            <input className="input" readOnly value={option.place.name} aria-label={`장소${index + 1}`} />
            <button type="button" className="btn secondary sm" onClick={startChange}>
              변경
            </button>
          </>
        ) : (
          <>
            <input
              className="input ime-ko"
              lang="ko"
              value={search.keyword}
              placeholder={`장소${index + 1} (검색 후 선택)`}
              aria-label={`장소${index + 1} 검색`}
              autoFocus={changing}
              onChange={(e) => search.setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void search.run()
                }
              }}
            />
            <button
              type="button"
              className="btn secondary sm"
              disabled={!search.ready || search.loading}
              onClick={() => void search.run()}
            >
              {search.loading ? '…' : '검색'}
            </button>
            {changing && (
              <button type="button" className="btn secondary sm" onClick={stopChange}>
                취소
              </button>
            )}
          </>
        )}
        <button
          type="button"
          className={`${styles.calBtn}${option.when ? ` ${styles.on}` : ''}`}
          onClick={() => setPickOpen(true)}
          aria-label={`장소${index + 1} 날짜·시간 선택`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
        </button>
        {removable && (
          <button type="button" className={styles.remove} onClick={onRemove} aria-label="항목 삭제">
            ✕
          </button>
        )}
      </div>

      {option.when && <p className={styles.when}>📅 {formatWhen(option.when)}</p>}
      {pickOpen && <DateTimePicker value={option.when} onChange={(v) => onChange({ when: v })} onClose={() => setPickOpen(false)} />}
      {search.error && searching && <p className={styles.msg}>{search.error}</p>}
      {!search.error && searching && search.message && <p className={styles.when}>{search.message}</p>}

      {searching && search.results.length > 0 && (
        <ul className={styles.found} aria-label="장소 검색 결과">
          {search.results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  onChange({ place: { id: r.id, name: r.name, address: r.address, lat: r.lat, lng: r.lng } })
                  setChanging(false)
                  search.clear()
                  search.setKeyword('')
                }}
              >
                <strong>{r.name}</strong>
                <span>{r.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function VoteCreateModal({
  groupId,
  onClose,
  onCreated,
}: {
  groupId: number
  onClose: () => void
  /** 후보가 모두 저장된 뒤 호출 — 채팅방에 투표 카드를 올린다 */
  onCreated: (title: string, pollId: string) => Promise<void> | void
}) {
  const [title, setTitle] = useState('')
  const [options, setOptions] = useState<Option[]>(() => [blank(), blank()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const patch = (key: number, p: Partial<Option>) =>
    setOptions((cur) => cur.map((o) => (o.key === key ? { ...o, ...p } : o)))

  async function submit() {
    setError('')
    const t = title.trim()
    if (!t) return setError('투표 제목을 적어 주세요.')
    if (options.some((o) => !o.place || !o.when))
      return setError('모든 항목에 장소(검색해서 선택)와 날짜·시간을 정해 주세요. 쓰지 않을 항목은 ✕ 로 지워요.')
    if (options.length < MIN_OPTIONS) return setError(`항목은 ${MIN_OPTIONS}개 이상이어야 투표할 수 있어요.`)
    setBusy(true)
    // 이미 확정된 약속과 시간이 겹치면 후보를 하나도 만들기 전에 알려 준다 (서버도 똑같이 막는다)
    try {
      const confirmed = (await api<{ title: string; meeting_time: string; status: string }[]>(`/groups/${groupId}/meetings`)).filter(
        (x) => x.status === 'confirmed',
      )
      for (const o of options) {
        const at = new Date(o.when).getTime()
        const clash = confirmed.find((x) => Math.abs(new Date(x.meeting_time).getTime() - at) < 120 * 60 * 1000)
        if (clash) {
          setError(`'${formatWhen(o.when)}' 은 이미 확정된 약속 '${clash.title}' (${formatWhen(clash.meeting_time)}) 과 시간이 겹쳐요. 2시간 이상 떨어진 시간으로 정해 주세요.`)
          setBusy(false)
          return
        }
      }
    } catch {
      /* 확인에 실패해도 서버가 다시 검사한다 */
    }
    const pollId = crypto.randomUUID() // 이 투표의 후보들을 하나로 묶는 번호
    try {
      for (const o of options) {
        const place = o.place as PlaceValue
        await api(`/groups/${groupId}/meeting-candidates`, {
          method: 'POST',
          body: {
            title: t,
            location: place.name,
            meeting_time: new Date(o.when).toISOString(),
            place_id: place.id || null,
            place_address: place.address || null,
            place_lat: place.lat,
            place_lng: place.lng,
            poll_id: pollId,
          },
        })
      }
      await onCreated(t, pollId)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '투표를 만들지 못했어요.')
      setBusy(false)
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="투표 만들기">
      <div className={styles.modal}>
        <div className={styles.head}>
          <h2>투표 만들기</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="닫기" disabled={busy}>
            ✕
          </button>
        </div>

        <label className={styles.label} htmlFor="vote-title">투표 제목</label>
        <input
          id="vote-title"
          className="input ime-ko"
          lang="ko"
          autoFocus
          value={title}
          maxLength={100}
          placeholder="예: 이번 주말 모임 어디서 할까?"
          onChange={(e) => setTitle(e.target.value)}
        />

        <label className={styles.label}>항목 (장소 + 날짜·시간)</label>
        {options.map((o, i) => (
          <OptionRow
            key={o.key}
            index={i}
            option={o}
            removable={options.length > MIN_OPTIONS}
            onChange={(p) => patch(o.key, p)}
            onRemove={() => setOptions((cur) => cur.filter((x) => x.key !== o.key))}
          />
        ))}
        {options.length < MAX_OPTIONS && (
          <button type="button" className={styles.add} onClick={() => setOptions((cur) => [...cur, blank()])}>
            + 항목 추가
          </button>
        )}

        {error && <p className={styles.msg}>{error}</p>}

        <div className={styles.actions}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button type="button" className="btn" onClick={submit} disabled={busy}>
            {busy ? '만드는 중…' : '투표 올리기'}
          </button>
        </div>
      </div>
    </div>
  )
}
