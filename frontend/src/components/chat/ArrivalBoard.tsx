'use client'

import { useEffect, type CSSProperties } from 'react'
import type { useLocationShare } from '@/hooks/useLocationShare'
import { useArrivals, type ArrivalStatus } from '@/hooks/useArrivals'

type Meet = ReturnType<typeof useLocationShare>

const ACCENT = '#3f7d6e'

const STATUS: Record<
  ArrivalStatus,
  { label: string; color: string; bg: string }
> = {
  arrived: { label: '도착', color: ACCENT, bg: 'rgba(63,125,110,0.16)' },
  moving: { label: '이동 중', color: '#92610f', bg: 'rgba(183,121,31,0.16)' },
  sharing: { label: '공유 중', color: ACCENT, bg: 'rgba(63,125,110,0.10)' },
  not_sharing: {
    label: '공유 안 함',
    color: '#6b7280',
    bg: 'rgba(0,0,0,0.06)',
  },
}

const ORDER: ArrivalStatus[] = ['arrived', 'moving', 'sharing', 'not_sharing']

const pill = (status: ArrivalStatus): CSSProperties => ({
  display: 'inline-block',
  padding: '4px 10px',
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 700,
  color: STATUS[status].color,
  background: STATUS[status].bg,
})

function whenText(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function relText(diffMin: number) {
  if (diffMin > 0) {
    const h = Math.floor(diffMin / 60)
    const m = diffMin % 60
    return h > 0 ? `${h}시간 ${m}분 뒤 시작` : `${m}분 뒤 시작`
  }
  if (diffMin === 0) return '지금 시작해요'
  return `시작한 지 ${-diffMin}분 지났어요`
}

function distanceText(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${meters}m`
}

/** 약속이 임박하면 나타나는 Meet Mode 시작 카드 + 친구들의 도착 현황 */
export default function ArrivalBoard({ meet }: { meet: Meet }) {
  const { arrivals, now, reload } = useArrivals(meet.groupId)
  const { sharing, asking, busy } = meet

  // 내 공유 상태가 바뀌면 도착 현황도 바로 다시 가져온다
  useEffect(() => {
    void reload()
  }, [sharing, reload])

  if (!arrivals?.meeting) return null

  const meeting = arrivals.meeting
  const diffMin = Math.round(
    (new Date(meeting.meeting_time).getTime() - now) / 60000,
  )
  const members = [...arrivals.members].sort(
    (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status),
  )
  const summaryItems = ORDER.filter((s) => arrivals.summary[s] > 0)

  return (
    <section
      className="card mint"
      aria-label="Meet Mode 도착 현황"
      style={{ borderRadius: 24, padding: 20 }}
    >
      <span className="chip">📅 오늘 약속이 있어요</span>
      <h2 className="card-title" style={{ margin: '10px 0 4px', fontSize: 20 }}>
        {meeting.title}
      </h2>
      <p className="muted" style={{ margin: 0 }}>
        {whenText(meeting.meeting_time)} · 📍 {meeting.location}
      </p>
      <p style={{ margin: '4px 0 0', fontWeight: 700, color: ACCENT }}>
        {relText(diffMin)}
      </p>

      {summaryItems.length > 0 && (
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}
        >
          {summaryItems.map((s) => (
            <span key={s} style={pill(s)}>
              {STATUS[s].label} {arrivals.summary[s]}
            </span>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {members.map((m) => (
          <div
            key={m.user_id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              padding: '8px 0',
            }}
          >
            <span>
              <strong>{m.nickname ?? '알 수 없음'}</strong>
              {m.mine ? ' (나)' : ''}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {m.distance_m !== null && (
                <span className="muted" style={{ fontSize: 13 }}>
                  약 {distanceText(m.distance_m)}
                </span>
              )}
              <span style={pill(m.status)}>{STATUS[m.status].label}</span>
            </span>
          </div>
        ))}
      </div>

      {!arrivals.destination_known && (
        <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
          약속 장소의 위치를 찾지 못해서 도착 여부는 판단하지 못해요.
        </p>
      )}

      <div style={{ marginTop: 14 }}>
        {sharing ? (
          <p className="muted" style={{ margin: 0 }}>
            내 위치를 공유 중이에요. 약속 장소 근처에 오면 자동으로
            &quot;도착&quot;으로 바뀌어요.
          </p>
        ) : (
          !asking && (
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={meet.openAsk}
            >
              Meet Mode 시작 · 내 위치 공유
            </button>
          )
        )}
      </div>

      <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
        대략적인 위치(약 500m)로 판단해서 오차가 있어요. 공유가 끝나면
        &quot;공유 안 함&quot;으로 돌아가요.
      </p>
    </section>
  )
}
