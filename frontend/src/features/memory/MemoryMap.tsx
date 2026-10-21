'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import PhotoMap, { type PhotoPin } from './PhotoMap'
import PhotoCollage from './PhotoCollage'
import { api, ApiError } from '@/lib/api'
import './maps.css'
import './photos.css'
import {
  formatDate,
  groupLabel,
  groupPhotos,
  type Photo,
  type PhotoGroup,
} from './photos'

/** 한 장소에 쌓인 추억들 (같은 장소에서 올린 사진 묶음이 여러 개일 수 있어요) */
type MemoryPlace = {
  key: string
  name: string
  address: string | null
  lat: number
  lng: number
  memories: PhotoGroup[] // 최신순
}

/** "서울 성동구 …" → "서울", "강원특별자치도 강릉시 …" → "강원" */
function regionOf(address: string | null) {
  const first = (address ?? '').trim().split(/\s+/)[0] ?? ''
  return (
    first.replace(/(특별자치도|특별자치시|특별시|광역시|도)$/, '') || '기타'
  )
}

function buildPlaces(photos: Photo[]): MemoryPlace[] {
  const withPlace = photos.filter(
    (p) => p.place_name && p.place_lat != null && p.place_lng != null,
  )
  const map = new Map<string, MemoryPlace>()
  for (const g of groupPhotos(withPlace)) {
    const pl = g.place
    if (!pl) continue
    const key = pl.id || `${pl.lat.toFixed(5)},${pl.lng.toFixed(5)}`
    const found = map.get(key)
    if (found) found.memories.push(g)
    else
      map.set(key, {
        key,
        name: pl.name,
        address: pl.address,
        lat: pl.lat,
        lng: pl.lng,
        memories: [g],
      })
  }
  return Array.from(map.values())
}

export default function MemoryMap({
  groupId,
  wantedBatch = null,
}: {
  groupId: string
  wantedBatch?: string | null
}) {
  const [warning, setWarning] = useState('')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [region, setRegion] = useState('전체')
  const [selectedKey, setSelectedKey] = useState('')
  const [selectedMemory, setSelectedMemory] = useState('')

  useEffect(() => {
    let cancelled = false
    api<{ photos: Photo[]; limited: boolean; storage_state: string }>(
      `/memory/groups/${groupId}/photos`,
    )
      .then((payload) => {
        const list = payload.photos

        if (cancelled) return
        setPhotos(list)
        const notices = []
        if (payload.limited)
          notices.push('최근 장소 사진 500장만 표시하고 있어요.')
        if (payload.storage_state !== 'ready')
          notices.push(
            '일부 사진 원본을 불러오지 못했어요. 장소와 기록은 확인할 수 있어요.',
          )
        setWarning(notices.join(' '))

        // 사진 상세에서 "지도에서 보기"로 들어오면 그 추억의 장소를 바로 선택
        if (wantedBatch) {
          const target = buildPlaces(list).find((pl) =>
            pl.memories.some((m) => m.key === wantedBatch),
          )
          if (target) {
            setSelectedKey(target.key)
            setSelectedMemory(wantedBatch)
          }
        }
      })
      .catch(
        (e) =>
          !cancelled &&
          setError(
            e instanceof ApiError ? e.message : '추억을 불러오지 못했어요.',
          ),
      )
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, wantedBatch])

  const allPlaces = useMemo(() => buildPlaces(photos), [photos])

  // 지역 칩 (주소 첫 단어 기준) : [이름, 추억 수]
  const regions = useMemo(() => {
    const count = new Map<string, number>()
    for (const pl of allPlaces) {
      const r = regionOf(pl.address)
      count.set(r, (count.get(r) ?? 0) + pl.memories.length)
    }
    return Array.from(count.entries()).sort((a, b) => b[1] - a[1])
  }, [allPlaces])

  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase()
    return allPlaces.filter((pl) => {
      if (region !== '전체' && regionOf(pl.address) !== region) return false
      if (!q) return true
      return [
        pl.name,
        pl.address,
        ...pl.memories.flatMap((m) => [
          m.title,
          m.memo,
          ...m.photos.map((p) => p.caption),
        ]),
      ].some((t) => (t || '').toLocaleLowerCase().includes(q))
    })
  }, [allPlaces, region, search])

  // 지도에 올릴 사진 말풍선: 장소마다 "가장 최근 추억의 첫 사진"을 대표 썸네일로, 그 장소의 사진 장수를 숫자로 보여줘요
  const mapPins: PhotoPin[] = useMemo(
    () =>
      visible.map((pl) => {
        const cover =
          pl.memories.flatMap((m) => m.photos).find((p) => p.signed_url) ?? null
        return {
          id: pl.key,
          name: pl.name,
          latitude: pl.lat,
          longitude: pl.lng,
          count: pl.memories.reduce((n, m) => n + m.photos.length, 0),
          time: Date.parse(pl.memories[0].created_at) || 0,
          thumb: cover?.signed_url ?? null,
        }
      }),
    [visible],
  )

  const place = visible.find((pl) => pl.key === selectedKey) ?? null
  const memory = place
    ? (place.memories.find((m) => m.key === selectedMemory) ??
      place.memories[0])
    : null
  const others =
    place && memory ? place.memories.filter((m) => m.key !== memory.key) : []
  const photoBase = `/groups/${groupId}/photos`
  const memoryCount = visible.reduce((n, pl) => n + pl.memories.length, 0)

  return (
    <>
      <div className="mm-filter">
        <input
          className="mm-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="장소 또는 추억 검색"
          aria-label="장소 또는 추억 검색"
        />
        <button
          type="button"
          className={region === '전체' ? 'mm-chip active' : 'mm-chip'}
          onClick={() => setRegion('전체')}
        >
          전체 {allPlaces.reduce((n, pl) => n + pl.memories.length, 0)}
        </button>
        {regions.map(([name, n]) => (
          <button
            key={name}
            type="button"
            className={region === name ? 'mm-chip active' : 'mm-chip'}
            onClick={() => setRegion(name)}
          >
            {name} {n}
          </button>
        ))}
      </div>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {warning && (
        <p className="muted" role="status" style={{ marginBottom: 16 }}>
          {warning}
        </p>
      )}

      <div className="mm-grid">
        <div>
          <div className="mm-mapbox">
            <PhotoMap
              pins={mapPins}
              selectedPinId={selectedKey}
              onPinClick={(p) => {
                setSelectedKey(p.id)
                setSelectedMemory('')
              }}
              height="540px"
            />
            {!loading && allPlaces.length === 0 && !error && (
              <div className="mm-empty">
                <h3>아직 장소가 있는 추억이 없어요</h3>
                <p>
                  그룹 친구가 사진 기능에서 장소를 지정해 남긴 추억이 여기에
                  모여요.
                </p>
              </div>
            )}
          </div>
          <div className="mm-legend">
            <span>
              장소 {visible.length}곳 · 추억 {memoryCount}개
            </span>
            <span>
              사진을 누르면 그 장소의 추억이 열려요 · 숫자는 사진 장수예요
            </span>
          </div>
        </div>

        <aside className="mm-side">
          {place && memory ? (
            <>
              <section className="card" data-testid="memory-card">
                <span className="chip">선택한 장소 · {place.name}</span>
                <Link
                  className="mm-photo mm-photo-link"
                  href={`${photoBase}/${memory.photos[0].id}`}
                  aria-label={`${groupLabel(memory)} 사진 자세히 보기`}
                >
                  <PhotoCollage group={memory} alt={groupLabel(memory)} />
                </Link>
                <h2 className="mm-title">{groupLabel(memory)}</h2>
                <p className="meta">
                  {formatDate(memory.created_at)} · 사진 {memory.photos.length}
                  장
                </p>
                {memory.memo?.trim() && (
                  <p className="mm-memo">{memory.memo.trim()}</p>
                )}
                <div className="mm-by">
                  <span className="avatar sm">
                    {(memory.uploader ?? '?').slice(0, 1)}
                  </span>
                  <span>{memory.uploader ?? '알 수 없음'}이(가) 남긴 추억</span>
                </div>
                <details style={{ marginTop: 16 }}>
                  <summary>이 추억의 사진 모두 보기</summary>
                  {memory.photos.map((photo) =>
                    photo.signed_url ? (
                      <Link
                        key={photo.id}
                        href={`${photoBase}/${photo.id}`}
                        className="mm-photo-link"
                        aria-label="이 사진 자세히 보기"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.signed_url}
                          alt={photo.caption || groupLabel(memory)}
                          style={{
                            width: '100%',
                            borderRadius: 12,
                            marginTop: 12,
                          }}
                        />
                      </Link>
                    ) : (
                      <p key={photo.id} className="muted">
                        이 사진의 임시 주소를 불러오지 못했어요.
                      </p>
                    ),
                  )}
                </details>
                <Link
                  className="btn"
                  style={{ marginTop: 14 }}
                  href={`${photoBase}/${memory.photos[0].id}`}
                >
                  사진 자세히 보기
                </Link>
                <p className="mm-soon" style={{ marginTop: 14 }}>
                  연결된 약속 보기 (약속 기능 연결 후 사용할 수 있어요)
                </p>
              </section>

              {others.length > 0 && (
                <section className="card">
                  <h2 className="card-title">이 장소의 다른 추억</h2>
                  <div className="mm-others">
                    {others.map((m) => (
                      <div className="mm-other" key={m.key}>
                        <strong>{groupLabel(m)}</strong>
                        <span className="meta">
                          {formatDate(m.created_at)} · 사진 {m.photos.length}장
                        </span>
                        <button
                          type="button"
                          className="link-arrow"
                          style={{
                            border: 0,
                            background: 'none',
                            padding: 0,
                            cursor: 'pointer',
                          }}
                          onClick={() => setSelectedMemory(m.key)}
                        >
                          함께 모아보기 →
                        </button>
                        {' · '}
                        <Link
                          className="link-arrow"
                          href={`${photoBase}/${m.photos[0].id}`}
                        >
                          사진 자세히 보기
                        </Link>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            <section className="card">
              <h2 className="card-title" style={{ marginBottom: 6 }}>
                장소를 눌러 보세요
              </h2>
              <p className="muted">
                지도에서 마커를 누르면 그곳에서 남긴 사진과 기록이 여기에
                나타나요.
              </p>
              {loading && (
                <p className="meta" style={{ marginTop: 10 }}>
                  추억을 불러오는 중이에요.
                </p>
              )}
            </section>
          )}
        </aside>
      </div>

      <section className="card mint mm-notice">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
        <div>
          <strong>추억의 장소는 그룹 친구들만 볼 수 있어요.</strong>
          <span className="muted">
            장소 정보가 없는 기록은 지도에 표시되지 않아요. 사진 올리기나 사진
            상세에서 장소를 추가해 주세요.
          </span>
        </div>
      </section>
    </>
  )
}
