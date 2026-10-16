'use client'

import { useEffect, useRef, useState } from 'react'
import type { TransitRoute } from './types'
import { estimateTransfer, getTransferWalks } from './transferEstimates'
import styles from './transit.module.css'

const API = (process.env.NEXT_PUBLIC_MEETING_API_URL ?? 'http://localhost:8001').replace(/\/$/, '')
const minutes = (seconds: number) => `${Math.ceil(Math.abs(seconds) / 60)}분`
const normalized = (name: string) => name.replace(/\s/g, '')

interface Station {
  station_id: string; ars_id: string | null; name: string
  longitude: number | null; latitude: number | null
}
interface Arrival {
  message: string; seconds: number | null; arrival_at_ms: number | null
  status: string
}
interface RecordItem {
  station_id: string; ars_id: string; route_id: string; route_name: string
  station_order: string; direction: string; next_stop: string
  arrivals: Arrival[]
}
interface Snapshot {
  observed_at_ms: number; received_at_ms: number; max_age_seconds: number
  records: RecordItem[]; clientReceivedAt: number
}
interface Boarding {
  index: number; isTransfer: boolean; stop: string; previousStop: string
  vehicles: string[]; nextStop: string; walkingSeconds: number | null
}

function getBusBoardings(route: TransitRoute): Boarding[] {
  const boardings: Boarding[] = []
  let previousTransit = -1
  route.steps.forEach((step, index) => {
    if (step.mode !== 'BUS' && step.mode !== 'SUBWAY') return
    if (step.mode === 'BUS') {
      const between = route.steps.slice(previousTransit + 1, index)
      const walkingSeconds = between.length > 0 && between.every((part) => part.mode === 'WALKING' && part.seconds !== null)
        ? between.reduce((sum, part) => sum + part.seconds!, 0) : null
      const previous = previousTransit >= 0 ? route.steps[previousTransit] : null
      boardings.push({ index, isTransfer: previousTransit >= 0,
        stop: step.stops[0] ?? '', nextStop: step.stops[1] ?? '', vehicles: step.vehicles,
        previousStop: previous?.stops[previous.stops.length - 1] ?? '설정한 출발지', walkingSeconds })
    }
    previousTransit = index
  })
  return boardings
}

async function getJson(path: string, signal?: AbortSignal) {
  const response = await fetch(`${API}${path}`, { signal })
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '버스 정보 조회 실패')
  return data
}

function BusTimingCard({ boarding }: { boarding: Boarding }) {
  const [query, setQuery] = useState(boarding.stop)
  const [stations, setStations] = useState<Station[]>([])
  const [station, setStation] = useState<Station | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [recordId, setRecordId] = useState('')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  const [buffer, setBuffer] = useState(60)
  const [error, setError] = useState('')
  const [searching, setSearching] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const searchVersion = useRef(0)

  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => { window.clearInterval(timer); searchVersion.current += 1 }
  }, [])

  const search = async () => {
    if (!query.trim()) { setError('승차 정류장 이름을 입력해 주세요.'); return }
    const version = ++searchVersion.current
    setSearching(true); setError(''); setStations([])
    setStation(null); setSnapshot(null); setRecordId(''); setStartedAt(null)
    try {
      const data = await getJson(`/seoul-bus/stations?keyword=${encodeURIComponent(query.trim())}`)
      if (version !== searchVersion.current) return
      const found = (data.stations as Station[]).filter((item) => item.ars_id && !/가상|미정차/.test(item.name))
      setStations(found)
      if (!found.length) setError('승차 가능한 정류장 후보가 없어요. 이름을 바꿔 검색해 주세요.')
    } catch (err) {
      if (version === searchVersion.current) setError(err instanceof Error ? err.message : '정류장 검색 실패')
    } finally {
      if (version === searchVersion.current) setSearching(false)
    }
  }

  // 정류장 선택 후 30초마다 조회. 페이지가 숨겨져 있으면 자동 조회하지 않는다.
  useEffect(() => {
    if (!station?.ars_id) return
    let cancelled = false
    let busy = false
    let controller: AbortController | null = null
    const refresh = async () => {
      if (busy || document.hidden) return
      busy = true; setRefreshing(true)
      controller = new AbortController()
      const timer = window.setTimeout(() => controller?.abort(), 20000)
      try {
        const data = await getJson(`/seoul-bus/arrival-status?ars_id=${encodeURIComponent(station.ars_id!)}`, controller.signal)
        if (!cancelled) {
          setSnapshot({ ...data, clientReceivedAt: Date.now() })
          setError('')
        }
      } catch {
        if (!cancelled) {
          setSnapshot(null)
          setError('도착 정보를 갱신하지 못했어요. 30초 후 다시 조회합니다.')
        }
      } finally {
        window.clearTimeout(timer)
        busy = false
        if (!cancelled) setRefreshing(false)
      }
    }
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, 30000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      cancelled = true; controller?.abort(); window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [station])

  const key = (record: RecordItem) => `${record.station_id}:${record.route_id}:${record.station_order}`
  const matches = (snapshot?.records ?? []).filter((record) =>
    record.station_id === station?.station_id && boarding.vehicles.some((name) => normalized(name) === normalized(record.route_name)))
  const record = matches.find((item) => key(item) === recordId)
  // 브라우저와 서버 시계 차이를 줄이기 위해 수신 시점을 기준으로 상대시간 환산.
  const observedAt = snapshot ? snapshot.clientReceivedAt - (snapshot.received_at_ms - snapshot.observed_at_ms) : null
  const age = observedAt === null ? null : Math.max(0, (now - observedAt) / 1000)
  const remainingWalk = startedAt !== null && boarding.walkingSeconds !== null
    ? Math.max(0, boarding.walkingSeconds - Math.max(0, (now - startedAt) / 1000)) : null

  return <article className={styles.timingCard}>
    <span className={styles.badge}>{boarding.isTransfer ? '버스 환승' : '첫 버스 승차'}</span>
    <h3>{boarding.previousStop} → {boarding.stop || '승차 정류장 확인 필요'}</h3>
    <p>경로 노선: {boarding.vehicles.join(' / ') || '노선명 미제공'}</p>
    <p>예상 도보: <strong>{boarding.walkingSeconds === null ? '정보 미제공' : minutes(boarding.walkingSeconds)}</strong></p>
    <div className={styles.row}>
      <input className={styles.input} aria-label="실시간 조회 정류장 검색어" value={query} onChange={(event) => {
        searchVersion.current += 1; setSearching(false); setQuery(event.target.value)
        setStations([]); setStation(null); setSnapshot(null); setRecordId(''); setStartedAt(null)
      }} />
      <button type="button" className={styles.button} disabled={searching} onClick={search}>{searching ? '검색 중' : '정류장 찾기'}</button>
    </div>
    {!!stations.length && <div style={{ marginTop: 12 }}>
      <label className={styles.label}>실제 승차할 정류장 선택</label>
      <select className={styles.input} aria-label="실제 승차 정류장" value={station?.station_id ?? ''} onChange={(event) => {
        setStation(stations.find((item) => item.station_id === event.target.value) ?? null)
        setSnapshot(null); setRecordId(''); setStartedAt(null); setError('')
      }}>
        <option value="">정류장 번호와 위치를 확인해 선택하세요</option>
        {stations.map((item) => <option key={item.station_id} value={item.station_id}>
          {item.name} · {item.ars_id} · {item.latitude?.toFixed(5)}, {item.longitude?.toFixed(5)}
        </option>)}
      </select>
      {station && <p className={styles.hint}>
        <a target="_blank" rel="noreferrer" href={`https://map.kakao.com/link/search/${encodeURIComponent(`${station.name} ${station.ars_id}`)}`}>카카오맵에서 정류장 위치 확인</a>
      </p>}
    </div>}
    {refreshing && <p className={styles.hint} role="status">실시간 도착 정보 갱신 중…</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {snapshot && <>
      <p className={styles.hint}>도착 정보 조회 후 약 {Math.floor(age ?? 0)}초 · 30초마다 갱신</p>
      {!matches.length && <p className={styles.hint}>선택한 정류장에 경로와 이름이 정확히 일치하는 노선이 없어요. 다른 정류장을 확인해 주세요. 노선명을 추측해서 연결하지 않습니다.</p>}
      {!!matches.length && <>
        <label className={styles.label}>노선·방향 확인</label>
        <p className={styles.hint}>경로의 다음 정류장: {boarding.nextStop || '미제공'}. 같은 번호여도 방향을 확인해 주세요.</p>
        <select className={styles.input} aria-label="버스 노선과 방향 확인" value={recordId} onChange={(event) => { setRecordId(event.target.value); setStartedAt(null) }}>
          <option value="">방향을 확인하고 선택하세요</option>
          {matches.map((item) => <option key={key(item)} value={key(item)}>
            {item.route_name} · {item.direction || '방향 미제공'} · 다음: {item.next_stop || '미제공'}
          </option>)}
        </select>
      </>}
    </>}
    {record && snapshot && <>
      <p className={styles.hint}>정확히 이 출발 지점에서 걷기 시작할 때 눌러 주세요. GPS 추적이 아닌 경로 도보시간 기준 예상입니다.</p>
      <button type="button" className={`${styles.button} ${styles.wide}`} disabled={boarding.walkingSeconds === null}
        onClick={() => { const value = Date.now(); setNow(value); setStartedAt(value) }}>
        {boarding.isTransfer ? '지금 직전 하차 지점에서 환승 이동 시작' : '지금 설정한 출발지에서 걷기 시작'}
      </button>
      {startedAt !== null && <p>정류장까지 예상 남은 이동: <strong>{minutes(remainingWalk ?? 0)}</strong></p>}
      {startedAt !== null && remainingWalk === 0 && <p className={styles.hint}>예상 도보시간이 지났어요. 실제 도착을 확인한 것은 아닙니다. 아직 도착하지 않았다면 여유 판단을 사용하지 마세요.</p>}
      <label className={styles.label}>탑승 준비 여유
        <select value={buffer} className={styles.input} onChange={(event) => setBuffer(Number(event.target.value))}>
          <option value={60}>1분 확보</option><option value={120}>2분 확보</option><option value={180}>3분 확보</option>
        </select>
      </label>
      {record.arrivals.map((arrival, index) => {
        const arrivalAt = arrival.arrival_at_ms === null ? null
          : snapshot.clientReceivedAt + arrival.arrival_at_ms - snapshot.received_at_ms
        const estimate = estimateTransfer({ nowMs: now, observedAtMs: observedAt,
          busArrivalAtMs: arrivalAt, remainingToStopSeconds: remainingWalk,
          bufferSeconds: buffer, maxAgeSeconds: snapshot.max_age_seconds })
        const fresh = age !== null && age <= snapshot.max_age_seconds
        const busSeconds = arrivalAt === null ? null : (arrivalAt - now) / 1000
        return <div key={index} style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #dce7e0' }}>
          <strong>{index === 0 ? '첫 번째 버스' : '두 번째 버스'}</strong>
          <p>{!fresh ? '도착 정보가 오래됐어요. 갱신 대기 중입니다.'
            : arrival.status === 'timed' && busSeconds !== null
              ? busSeconds >= 0 ? `예상 도착까지 ${minutes(busSeconds)}` : '예상 도착시각 경과 · 갱신 대기'
              : arrival.message}</p>
          <p className={styles.hint}>서울시 안내: {arrival.message}</p>
          {startedAt === null ? <p className={styles.hint}>이동 시작을 누르면 환승 여유를 계산해요.</p>
            : arrival.status === 'timed' && fresh ? <>
              <p style={{ color: estimate.status === 'comfortable' ? '#247c73' : '#a35b2e', fontWeight: 700 }}>{estimate.label}</p>
              {estimate.marginSeconds !== null && <p className={styles.hint}>
                도착 전 예상 여유 {estimate.marginSeconds < 0 ? '-' : ''}{minutes(estimate.marginSeconds)}
                {' '}· 준비 {minutes(buffer)} 제외 후 {estimate.usableMarginSeconds! < 0 ? '-' : ''}{minutes(estimate.usableMarginSeconds!)}
              </p>}
            </> : <p className={styles.hint}>정확한 도착시간을 확인할 수 없어 여유를 판단하지 않아요.</p>}
        </div>
      })}
      <p className={styles.hint}>여유 판단은 예상치입니다. 신호 대기·보행 속도·교통 상황·앞선 차량 대기는 반영되지 않으며 탑승을 보장하지 않습니다.</p>
    </>}
  </article>
}

export default function TransferTiming({ route }: { route: TransitRoute }) {
  const transfers = getTransferWalks(route)
  const boardings = getBusBoardings(route)
  if (!transfers.length && !boardings.length) return null
  return <section className={`${styles.panel} ${styles.details}`}>
    <h2>환승 이동시간 · 버스 도착</h2>
    {transfers.filter((transfer) => transfer.mode !== 'BUS').map((transfer) => <article key={transfer.boardingStep} className={styles.timingCard}>
      <h3>{transfer.from} → {transfer.to}</h3>
      <p>지하철 환승 도보: {transfer.seconds === null ? '미제공' : minutes(transfer.seconds)}</p>
      <p className={styles.hint}>지하철 실시간 도착 정보는 아직 연결하지 않았어요.</p>
    </article>)}
    {boardings.map((boarding) => <BusTimingCard key={boarding.index} boarding={boarding} />)}
    <p className={styles.hint}>출처: 서울특별시 버스정보시스템 · 현재 서버는 로컬 개발용입니다.</p>
  </section>
}
