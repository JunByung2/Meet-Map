'use client'

import { useState } from 'react'
import styles from './vote.module.css'

const pad = (n: number) => String(n).padStart(2, '0')

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 날짜·시간 고르기: 날짜는 달력, 시간은 "시 : 분"을 직접 입력하고 [적용]을 누른다.
 * value / onChange 는 `YYYY-MM-DDTHH:mm` 형식 (datetime-local 과 같은 모양)
 */
export default function DateTimePicker({
  value,
  onChange,
  onClose,
}: {
  value: string
  onChange: (v: string) => void
  onClose: () => void
}) {
  const [date, setDate] = useState(value ? value.slice(0, 10) : today())
  const [hour, setHour] = useState(value ? String(Number(value.slice(11, 13))) : '')
  const [minute, setMinute] = useState(value ? pad(Number(value.slice(14, 16))) : '')
  const [error, setError] = useState('')

  function apply() {
    const h = Number(hour)
    const m = minute === '' ? 0 : Number(minute)
    if (!date) return setError('날짜를 골라 주세요.')
    if (hour === '' || !Number.isInteger(h) || h < 0 || h > 23) return setError('시는 0~23 사이로 적어 주세요. (오후 6시 → 18)')
    if (!Number.isInteger(m) || m < 0 || m > 59) return setError('분은 0~59 사이로 적어 주세요.')
    onChange(`${date}T${pad(h)}:${pad(m)}`)
    onClose()
  }

  return (
    <div className={styles.dtBack} role="dialog" aria-modal="true" aria-label="날짜·시간 선택" onClick={onClose}>
      <div className={styles.dtBox} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.dtTitle}>날짜 · 시간</h3>

        <p className={styles.dtLabel}>날짜</p>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />

        <p className={styles.dtLabel}>시간 (24시간 기준)</p>
        <div className={styles.dtTime}>
          <input
            className="input"
            inputMode="numeric"
            maxLength={2}
            placeholder="시"
            aria-label="시"
            value={hour}
            onChange={(e) => setHour(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && apply()}
            autoFocus
          />
          <span>시</span>
          <input
            className="input"
            inputMode="numeric"
            maxLength={2}
            placeholder="분"
            aria-label="분"
            value={minute}
            onChange={(e) => setMinute(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && apply()}
          />
          <span>분</span>
        </div>

        {error && <p className={styles.msg}>{error}</p>}
        <div className={styles.actions} style={{ marginTop: 16 }}>
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="button" className="btn" onClick={apply}>적용</button>
        </div>
      </div>
    </div>
  )
}
