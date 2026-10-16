'use client'

import { useEffect, useRef, useState } from 'react'
import TransitCanvas from './TransitCanvas'
import TransferTiming from './TransferTiming'
import { loadMapSdk } from './sdk'
import type { Place, TransitRoute } from './types'
import styles from './transit.module.css'

type Target = 'origin' | 'destination'
interface SearchResult {
  id: string; place_name: string; x: string; y: string
  address_name: string; road_address_name: string
}

const API_BASE = (process.env.NEXT_PUBLIC_MEETING_API_URL ?? 'http://localhost:8001').replace(/\/$/, '')
const modeName = (mode: string) => ({ BUS: '버스', SUBWAY: '지하철', BUS_AND_SUBWAY: '버스 + 지하철', WALKING: '도보' }[mode] ?? '이동')
const timeLabel = (seconds: number | null) => seconds === null ? '시간 정보 없음' : `${Math.round(seconds / 60 * 10) / 10}분`
const distanceLabel = (distance: number | null) => distance === null ? '거리 정보 없음' : distance >= 1000 ? `${(distance / 1000).toFixed(1)}km` : `${Math.round(distance)}m`
const fareLabel = (route: TransitRoute) => {
  if (route.fare !== null) return `${route.fare.toLocaleString('ko-KR')}원`
  if (route.fare_min !== null && route.fare_max !== null) {
    return `${route.fare_min.toLocaleString('ko-KR')}~${route.fare_max.toLocaleString('ko-KR')}원`
  }
  return '요금 정보 없음'
}

export default function TransitPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [origin, setOrigin] = useState<Place | null>(null)
  const [destination, setDestination] = useState<Place | null>(null)
  const [queries, setQueries] = useState({ origin: '', destination: '' })
  const [searchTarget, setSearchTarget] = useState<Target>('origin')
  const [results, setResults] = useState<Place[]>([])
  const [searching, setSearching] = useState(false)
  const [searchMessage, setSearchMessage] = useState('')
  const [routes, setRoutes] = useState<TransitRoute[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('ALL')
  const [sort, setSort] = useState('time')
  const searchVersion = useRef(0)
  const requestVersion = useRef(0)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => {
    searchVersion.current += 1
    requestVersion.current += 1
    controller.current?.abort()
  }, [])

  const clearRoutes = () => {
    requestVersion.current += 1
    controller.current?.abort()
    setRoutes([])
    setSelectedId('')
    setError('')
    setLoading(false)
  }

  const editQuery = (target: Target, value: string) => {
    clearRoutes()
    searchVersion.current += 1
    setSearching(false)
    setResults([])
    setSearchMessage('')
    setQueries((previous) => ({ ...previous, [target]: value }))
    if (target === 'origin') setOrigin(null)
    else setDestination(null)
  }

  const search = async (target: Target) => {
    const query = queries[target].trim()
    if (!query) { setSearchMessage('검색할 장소를 입력해 주세요.'); return }
    const version = ++searchVersion.current
    setSearching(true)
    setSearchTarget(target)
    setSearchMessage('')
    setResults([])
    try {
      await loadMapSdk()
      if (version !== searchVersion.current) return
      const k = window.kakao.maps
      const service = new k.services.Places()
      service.keywordSearch(query, (data: SearchResult[], status: string) => {
        if (version !== searchVersion.current) return
        setSearching(false)
        if (status !== k.services.Status.OK) {
          setSearchMessage(status === k.services.Status.ZERO_RESULT ? '검색 결과가 없어요.' : '검색에 실패했어요.')
          return
        }
        setResults(data.map((place) => ({
          id: place.id, name: place.place_name,
          address: place.road_address_name || place.address_name,
          longitude: Number(place.x), latitude: Number(place.y),
        })).filter((place) => Number.isFinite(place.longitude) && Number.isFinite(place.latitude)))
      })
    } catch (err) {
      if (version !== searchVersion.current) return
      setSearching(false)
      setSearchMessage(err instanceof Error ? err.message : '장소 검색 실패')
    }
  }

  const choosePlace = (place: Place) => {
    clearRoutes()
    searchVersion.current += 1
    setSearching(false)
    if (searchTarget === 'origin') setOrigin(place)
    else setDestination(place)
    setQueries((previous) => ({ ...previous, [searchTarget]: place.name }))
    setResults([])
    setSearchMessage('')
  }

  const swap = () => {
    clearRoutes()
    searchVersion.current += 1
    setSearching(false)
    setResults([])
    setSearchMessage('')
    setOrigin(destination)
    setDestination(origin)
    setQueries({ origin: queries.destination, destination: queries.origin })
  }

  const loadRoutes = async () => {
    if (!origin || !destination || loading) return
    if (Math.abs(origin.longitude - destination.longitude) < 0.000001 && Math.abs(origin.latitude - destination.latitude) < 0.000001) {
      setError('출발지와 목적지가 같습니다. 다른 장소를 선택해 주세요.')
      return
    }
    const version = ++requestVersion.current
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    const timeout = window.setTimeout(() => abort.abort(), 25000)
    setLoading(true)
    setError('')
    setRoutes([])
    setSelectedId('')
    setFilter('ALL')
    try {
      const response = await fetch(`${API_BASE}/transit/routes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          start: { x: origin.longitude, y: origin.latitude },
          end: { x: destination.longitude, y: destination.latitude },
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '교통 조회에 실패했어요.')
      if (!Array.isArray(data.routes)) throw new Error('경로 응답 형식이 올바르지 않습니다.')
      if (version === requestVersion.current) {
        setRoutes(data.routes)
        if (!data.routes.length) setError('조회 가능한 경로가 없습니다.')
      }
    } catch (err) {
      if (version !== requestVersion.current) return
      setError(abort.signal.aborted ? '조회 시간이 초과됐어요. 다시 시도해 주세요.'
        : err instanceof TypeError ? '교통 서버에 연결하지 못했어요. 8001번 서버를 확인해 주세요.'
        : err instanceof Error ? err.message : '교통 조회 실패')
    } finally {
      window.clearTimeout(timeout)
      if (version === requestVersion.current) setLoading(false)
    }
  }

  const visibleRoutes = routes.filter((route) => filter === 'ALL' || route.mode === filter)
    .sort((a, b) => sort === 'transfers'
      ? (a.transfers ?? Infinity) - (b.transfers ?? Infinity) || a.seconds - b.seconds
      : a.seconds - b.seconds || (a.transfers ?? Infinity) - (b.transfers ?? Infinity))
  const activeRoute = visibleRoutes.find((route) => route.id === selectedId) ?? visibleRoutes[0] ?? null
  const hasPath = activeRoute?.steps.some((step) => step.points.length >= 2)

  return <div className={styles.page}>
    {!embedded && <header className={styles.header}>
      <div><span className={styles.badge}>MeetMap · 교통 보기</span><h1>대중교통 길찾기</h1>
        <p className={styles.hint}>출발지와 목적지를 검색하고, 이동 경로와 환승 안내를 확인하세요.</p></div>
      <a href="/groups">내 그룹</a>
    </header>}
    <div className={styles.layout}>
      <aside className={styles.panel}>
        <h2>어디로 이동할까요?</h2>
        {(['origin', 'destination'] as const).map((target) => <form key={target} onSubmit={(event) => {
          event.preventDefault(); void search(target)
        }}>
          <label className={styles.label} htmlFor={`transit-${target}`}>{target === 'origin' ? '출발지' : '목적지'}</label>
          <div className={styles.row}>
            <input id={`transit-${target}`} className={styles.input} value={queries[target]}
              placeholder={target === 'origin' ? '예: 홍대입구역' : '예: 강남역'}
              onChange={(event) => editQuery(target, event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} />
            <button className={styles.button} type="submit" disabled={searching}>검색</button>
          </div>
          <p className={styles.selectedPlace}>{(target === 'origin' ? origin : destination) ? '✓ 장소 선택 완료' : '검색 결과에서 장소를 선택해 주세요.'}</p>
        </form>)}
        <button className={`${styles.button} ${styles.secondary} ${styles.wide}`} onClick={swap} type="button">출발 · 도착 바꾸기 ⇅</button>
        {searching && <p className={styles.hint} role="status">장소 검색 중…</p>}
        {searchMessage && <p className={styles.error} role="status">{searchMessage}</p>}
        {!!results.length && <div className={styles.results} aria-label="장소 검색 결과">
          <p className={styles.hint}>{searchTarget === 'origin' ? '출발지' : '목적지'}로 선택</p>
          {results.map((place) => <button type="button" key={place.id} className={styles.searchItem} onClick={() => choosePlace(place)}>
            <strong>{place.name}</strong><div className={styles.hint}>{place.address}</div>
          </button>)}
        </div>}
        <button className={`${styles.button} ${styles.wide}`} type="button" onClick={loadRoutes} disabled={!origin || !destination || loading}>
          {loading ? '교통 경로 조회 중…' : '교통 보기'}
        </button>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {!!routes.length && <>
          <div className={styles.filters}>
            <select aria-label="교통수단 필터" value={filter} onChange={(event) => { setFilter(event.target.value); setSelectedId('') }}>
              <option value="ALL">전체 수단</option><option value="SUBWAY">지하철</option>
              <option value="BUS">버스</option><option value="BUS_AND_SUBWAY">버스 + 지하철</option>
            </select>
            <select aria-label="경로 정렬" value={sort} onChange={(event) => { setSort(event.target.value); setSelectedId('') }}>
              <option value="time">최소 시간순</option><option value="transfers">최소 환승순</option>
            </select>
          </div>
          <p className={styles.hint}>조회된 경로 {routes.length}개 · 표시 {visibleRoutes.length}개</p>
          {!visibleRoutes.length && <p className={styles.hint}>이 수단의 경로가 없어요. 다른 수단을 선택해 주세요.</p>}
          <div className={styles.routeList}>
            {visibleRoutes.map((route, index) => <button type="button" key={route.id}
              aria-pressed={activeRoute?.id === route.id}
              className={`${styles.routeCard} ${activeRoute?.id === route.id ? styles.active : ''}`}
              onClick={() => setSelectedId(route.id)}>
              <span className={styles.badge}>경로 {index + 1} · {modeName(route.mode)}</span>
              <div className={styles.routeTitle}>{timeLabel(route.seconds)}</div>
              <div>{route.transfers === null ? '환승 정보 없음' : `환승 ${route.transfers}회`} · {distanceLabel(route.distance)}</div>
              <p className={styles.hint}>예상 요금 {fareLabel(route)}</p>
              <p className={styles.hint}>{route.steps.map((step) => modeName(step.mode)).join(' → ')}</p>
            </button>)}
          </div>
        </>}
      </aside>
      <section>
        <TransitCanvas origin={origin} destination={destination} route={activeRoute} />
        <p className={styles.hint}>지도: 출발·도착 표시 / 파란색 버스 / 보라색 지하철 / 회색 점선 도보</p>
        {activeRoute && !hasPath && <p className={styles.hint}>이 경로는 표시 가능한 좌표가 없어 상세 안내만 제공해요.</p>}
        {activeRoute && <details className={`${styles.panel} ${styles.details}`}>
          <summary>서울 버스 도착 정보</summary>
          <TransferTiming key={activeRoute.id} route={activeRoute} />
        </details>}
        {activeRoute && <section className={`${styles.panel} ${styles.details}`}>
          <h2>이렇게 이동하세요</h2>
          <p className={styles.hint}>경로 API의 예상 시간 기준입니다. 서울 버스 실시간 도착은 위 영역에서 확인할 수 있어요. 막차·혼잡도 정보는 포함하지 않습니다.</p>
          {!activeRoute.steps.length && <p>이 경로의 구간별 안내가 제공되지 않았어요.</p>}
          <ol className={styles.steps}>
            {activeRoute.steps.map((step, index) => {
              const transfer = (step.mode === 'BUS' || step.mode === 'SUBWAY') && activeRoute.steps.slice(0, index).some((previous) => previous.mode === 'BUS' || previous.mode === 'SUBWAY')
              return <li key={index} className={styles.step}>
                {transfer && <span className={styles.transfer}>다음 교통수단으로 환승</span>}
                <span className={styles.badge}>{index + 1} · {modeName(step.mode)}</span>
                <h3>{step.guidance}</h3>
                {!!step.vehicles.length && <p>이용 노선: {step.vehicles.join(' / ')}</p>}
                {step.stops.length >= 2 && <p>승차: {step.stops[0]} → 하차: {step.stops[step.stops.length - 1]}</p>}
                <p className={styles.hint}>{timeLabel(step.seconds)} · {distanceLabel(step.distance)}</p>
                {!!step.stops.length && <details><summary>경유 정류장·역 보기</summary>
                  <p className={styles.hint}>{step.stops.join(' → ')}</p></details>}
              </li>
            })}
          </ol>
        </section>}
      </section>
    </div>
  </div>
}
