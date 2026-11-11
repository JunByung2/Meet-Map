'use client'

import { useState } from 'react'
import type { useLocationShare } from '@/hooks/useLocationShare'
import type {
  Arrivals,
  ArrivalMember,
  ArrivalStatus,
} from '@/hooks/useArrivals'
import styles from './meetmode.module.css'

type Meet = ReturnType<typeof useLocationShare>

// 아바타 테두리 색: 도착 / 이동 중 / 공유 중 / 공유 안 함
const RING: Record<ArrivalStatus, string> = {
  arrived: '#2fb27d',
  moving: '#e0952b',
  sharing: '#3f7d6e',
  not_sharing: '#c3cbc9',
}

const LABEL: Record<ArrivalStatus, string> = {
  arrived: '도착',
  moving: '이동 중',
  sharing: '공유 중',
  not_sharing: '공유 안 함',
}

const ORDER: ArrivalStatus[] = ['arrived', 'moving', 'sharing', 'not_sharing']

function whenText(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function countdown(diffMin: number) {
  if (diffMin > 0) {
    const h = Math.floor(diffMin / 60)
    const m = diffMin % 60
    return { label: '약속까지', value: h > 0 ? `${h}시간 ${m}분` : `${m}분` }
  }
  if (diffMin === 0) return { label: '약속 시간', value: '지금이에요' }
  return { label: '약속 시간이 지났어요', value: `${-diffMin}분 지남` }
}

function distanceText(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${meters}m`
}

function subText(m: ArrivalMember) {
  if (m.status === 'arrived') return '도착'
  if (m.status === 'moving' && m.distance_m !== null)
    return `약 ${distanceText(m.distance_m)}`
  if (m.status === 'sharing') return '공유 중'
  return '-'
}

/** 약속이 있을 때 보이는 Meet Mode 본문: 카운트다운 + 도착 현황 + 빠른 행동 */
export default function ArrivalBoard({
  meet,
  arrivals,
  now,
  onQuick,
}: {
  meet: Meet
  arrivals: Arrivals
  now: number
  /** 빠른 한마디를 채팅으로 보낸다 */
  onQuick?: (text: string) => Promise<unknown> | void
}) {
  const { sharing, asking, busy } = meet
  const [copied, setCopied] = useState(false)
  const [sent, setSent] = useState('')

  const meeting = arrivals.meeting
  if (!meeting) return null

  const diffMin = Math.round(
    (new Date(meeting.meeting_time).getTime() - now) / 60000,
  )
  const cd = countdown(diffMin)
  const members = [...arrivals.members].sort(
    (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status),
  )
  const summary = (['arrived', 'moving', 'sharing'] as ArrivalStatus[])
    .filter((s) => arrivals.summary[s] > 0)
    .map((s) => `${arrivals.summary[s]}명 ${LABEL[s]}`)
    .join(' · ')

  const mapUrl = `https://map.kakao.com/link/search/${encodeURIComponent(
    meeting.location,
  )}`

  async function copyPlace() {
    try {
      await navigator.clipboard.writeText(meeting!.location)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 복사 권한이 없으면 조용히 넘어간다 */
    }
  }

  async function quick(text: string) {
    if (!onQuick) return
    try {
      await onQuick(text)
      setSent(text)
      setTimeout(() => setSent(''), 1800)
    } catch {
      /* 전송 실패 메시지는 채팅 쪽 상태줄이 보여준다 */
    }
  }

  return (
    <section className={styles.board} aria-label="Meet Mode 도착 현황">
      <div>
        <h2 className={styles.boardTitle}>{meeting.title}</h2>
        <p className={styles.when}>
          {whenText(meeting.meeting_time)}
          <br />
          📍 {meeting.location}
        </p>
      </div>

      <div className={styles.count}>
        <span className={styles.countLabel}>{cd.label}</span>
        <strong className={styles.countValue}>{cd.value}</strong>
      </div>

      <div className={styles.people}>
        {members.map((m) => {
          const name = m.nickname ?? '알 수 없음'
          return (
            <div key={m.user_id} className={styles.person}>
              <span
                className={styles.ring}
                style={{ borderColor: RING[m.status] }}
              >
                {name.slice(0, 1)}
              </span>
              <span className={styles.pname}>{m.mine ? '나' : name}</span>
              <span
                className={styles.psub}
                style={
                  m.status === 'arrived'
                    ? { color: '#1d7a4f', fontWeight: 700 }
                    : m.status === 'moving'
                      ? { color: '#b7791f', fontWeight: 700 }
                      : undefined
                }
              >
                {subText(m)}
              </span>
            </div>
          )
        })}
      </div>

      <p className={styles.summary}>
        {summary || '아직 위치를 공유한 친구가 없어요'}
      </p>

      {!arrivals.destination_known && (
        <p className={styles.note}>
          약속 장소의 위치를 찾지 못해서 도착 여부는 판단하지 못해요.
        </p>
      )}

      {sharing ? (
        <p className={styles.sharingNote}>
          📍 내 위치를 공유 중이에요. 약속 장소 근처에 오면 자동으로
          &quot;도착&quot;으로 바뀌어요.
        </p>
      ) : (
        !asking && (
          <button
            type="button"
            className={`btn ${styles.cta}`}
            disabled={busy}
            onClick={meet.openAsk}
          >
            내 위치 공유하기
          </button>
        )
      )}

      <div className={styles.links}>
        <a
          href={mapUrl}
          target="_blank"
          rel="noreferrer"
          className={styles.linkBtn}
        >
          🗺 길찾기
        </a>
        <button type="button" className={styles.linkBtn} onClick={copyPlace}>
          {copied ? '✅ 복사했어요' : '📋 장소 복사'}
        </button>
      </div>

      {onQuick && (
        <div className={styles.quick}>
          {['🏃 곧 도착해요', '⏳ 조금 늦어요'].map((t) => (
            <button
              key={t}
              type="button"
              className={styles.quickBtn}
              onClick={() => void quick(t)}
            >
              {sent === t ? '✅ 보냈어요' : t}
            </button>
          ))}
        </div>
      )}

      <p className={styles.note}>
        대략적인 위치(약 500m) 기준이라 오차가 있어요.
      </p>
    </section>
  )
}
