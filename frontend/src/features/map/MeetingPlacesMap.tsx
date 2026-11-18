'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { loadKakao, searchKeyword } from '@/lib/kakao'
import BaseKakaoMap, { type MapPlace } from './BaseKakaoMap'
import styles from './meetingPlaces.module.css'

type Group = { id: number; name: string; icon: string | null }

type Meeting = {
  id: number
  group_id: number
  title: string
  location: string
  place_address: string | null
  place_lat: number | null
  place_lng: number | null
  meeting_time: string
  status: string
}

type Item = {
  meeting: Meeting
  group: Group
  color: string
  lat: number | null
  lng: number | null
}

// 그룹마다 다른 마커 색 (그룹 번호가 작은 순서대로 배정해서, 늘 같은 그룹은 같은 색)
const GROUP_COLORS = [
  '#E5574F', // 빨강
  '#3B82C4', // 파랑
  '#E09A2B', // 주황
  '#8E5BC2', // 보라
  '#D2578F', // 분홍
  '#7A8B2E', // 올리브
  '#A8704A', // 갈색
  '#4F5BD5', // 남색
]

const FETCH_LIMIT = 15 // 좌표가 없는 약속을 장소 검색으로 찾는 최대 개수

function whenText(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 내가 속한 모든 그룹의 약속 장소를 지도에 찍는다. 그룹마다 마커 색이 다르다. */
export default function MeetingPlacesMap() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [range, setRange] = useState<'upcoming' | 'all'>('upcoming')
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const [selectedId, setSelectedId] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const groups = await api<Group[]>('/groups')
        const ordered = [...groups].sort((a, b) => a.id - b.id)
        const colorOf = new Map(
          ordered.map((g, i) => [g.id, GROUP_COLORS[i % GROUP_COLORS.length]]),
        )
        const results = await Promise.allSettled(
          groups.map((g) => api<Meeting[]>(`/groups/${g.id}/meetings`)),
        )
        if (cancelled) return

        const list: Item[] = []
        groups.forEach((g, i) => {
          const r = results[i]
          if (r.status !== 'fulfilled') return
          for (const m of r.value) {
            if (m.status === 'cancelled') continue
            list.push({
              meeting: m,
              group: g,
              color: colorOf.get(g.id) ?? GROUP_COLORS[0],
              lat: m.place_lat,
              lng: m.place_lng,
            })
          }
        })
        setItems(list)
        setLoading(false)

        // 예전 약속처럼 좌표가 없으면, 장소 이름으로 한 번 검색해서 찾아 본다
        const missing = Array.from(
          new Set(
            list
              .filter((it) => it.lat === null || it.lng === null)
              .map((it) => it.meeting.location),
          ),
        ).slice(0, FETCH_LIMIT)
        if (missing.length === 0) return
        try {
          const kakao = await loadKakao()
          const found = new Map<string, { lat: number; lng: number }>()
          for (const loc of missing) {
            const [first] = await searchKeyword(kakao, loc)
            if (first) found.set(loc, { lat: first.lat, lng: first.lng })
          }
          if (cancelled || found.size === 0) return
          setItems((cur) =>
            cur.map((it) => {
              if (it.lat !== null && it.lng !== null) return it
              const hit = found.get(it.meeting.location)
              return hit ? { ...it, lat: hit.lat, lng: hit.lng } : it
            }),
          )
        } catch {
          /* 카카오 검색을 못 쓰면 좌표 없는 약속은 목록에만 보인다 */
        }
      } catch {
        if (!cancelled) {
          setError('약속 정보를 불러오지 못했어요.')
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // 그룹 목록(범례): 약속이 있는 그룹만
  const legend = useMemo(() => {
    const map = new Map<
      number,
      { group: Group; color: string; count: number }
    >()
    for (const it of items) {
      const cur = map.get(it.group.id)
      if (cur) cur.count += 1
      else map.set(it.group.id, { group: it.group, color: it.color, count: 1 })
    }
    return Array.from(map.values()).sort((a, b) => a.group.id - b.group.id)
  }, [items])

  const visible = useMemo(() => {
    const from = startOfToday()
    return items
      .filter((it) => !hidden.has(it.group.id))
      .filter(
        (it) =>
          range === 'all' ||
          new Date(it.meeting.meeting_time).getTime() >= from,
      )
      .sort(
        (a, b) =>
          new Date(a.meeting.meeting_time).getTime() -
          new Date(b.meeting.meeting_time).getTime(),
      )
  }, [items, hidden, range])

  // places 가 새로 만들어질 때마다 지도가 다시 맞춰지므로, 바뀔 때만 만든다
  const places: MapPlace[] = useMemo(
    () =>
      visible
        .filter((it) => it.lat !== null && it.lng !== null)
        .map((it) => ({
          id: `meeting-${it.meeting.id}`,
          name: `${it.meeting.title} · ${it.group.name}`,
          latitude: it.lat as number,
          longitude: it.lng as number,
          color: it.color,
        })),
    [visible],
  )

  const noPlace = visible.length - places.length

  function toggleGroup(id: number) {
    setHidden((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setSelectedId('')
  }

  if (loading)
    return (
      <p className="muted" role="status">
        약속 장소를 불러오고 있어요.
      </p>
    )
  if (error)
    return (
      <section className="card">
        <p className="error" role="alert">
          {error}
        </p>
      </section>
    )
  if (items.length === 0)
    return (
      <section className="card">
        <p className="muted">
          아직 확정된 약속이 없어요. 채팅에서 투표로 약속을 정하면 여기에 장소가
          찍혀요.
        </p>
      </section>
    )

  return (
    <section className={styles.wrap}>
      <div className={styles.toolbar}>
        <div className={styles.legend} role="group" aria-label="그룹별 색">
          {legend.map(({ group, color, count }) => {
            const off = hidden.has(group.id)
            return (
              <button
                key={group.id}
                type="button"
                className={`${styles.chip} ${off ? styles.chipOff : ''}`}
                aria-pressed={!off}
                onClick={() => toggleGroup(group.id)}
              >
                <i className={styles.dot} style={{ background: color }} />
                {group.name}
                <span className={styles.count}>{count}</span>
              </button>
            )
          })}
        </div>
        <div className={styles.seg} role="group" aria-label="기간">
          <button
            type="button"
            className={range === 'upcoming' ? styles.segOn : ''}
            onClick={() => setRange('upcoming')}
          >
            다가오는 약속
          </button>
          <button
            type="button"
            className={range === 'all' ? styles.segOn : ''}
            onClick={() => setRange('all')}
          >
            전체
          </button>
        </div>
      </div>

      {places.length > 0 ? (
        <BaseKakaoMap
          places={places}
          selectedPlaceId={selectedId}
          onPlaceClick={(p) => setSelectedId(p.id)}
          height="440px"
        />
      ) : (
        <p className={styles.empty}>
          {visible.length === 0
            ? '이 조건에 맞는 약속이 없어요.'
            : '지도에 찍을 수 있는 약속이 없어요.'}
        </p>
      )}

      {noPlace > 0 && places.length > 0 && (
        <p className={styles.note}>
          {noPlace}개 약속은 장소 위치를 찾지 못해서 지도에는 없고 목록에만
          보여요.
        </p>
      )}

      <ul className={styles.list}>
        {visible.map((it) => {
          const id = `meeting-${it.meeting.id}`
          const canShow = it.lat !== null && it.lng !== null
          return (
            <li
              key={it.meeting.id}
              className={`${styles.row} ${selectedId === id ? styles.rowOn : ''}`}
            >
              <button
                type="button"
                className={styles.rowMain}
                disabled={!canShow}
                onClick={() => setSelectedId(id)}
              >
                <i className={styles.dot} style={{ background: it.color }} />
                <span className={styles.rowText}>
                  <strong>{it.meeting.title}</strong>
                  <span className="muted">
                    {it.group.name} · {whenText(it.meeting.meeting_time)}
                  </span>
                  <span className="muted">
                    📍 {it.meeting.location}
                    {!canShow && ' (위치를 찾지 못했어요)'}
                  </span>
                </span>
              </button>
              <Link
                href={`/groups/${it.group.id}/meetings`}
                className={styles.rowLink}
              >
                약속 보기 →
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
