'use client'

import { useEffect, useRef, useState } from 'react'
import { loadKakao } from './kakao'

import './maps.css'
import { Cluster, clusterPins, PinLike } from './cluster'

// =========================================
// 사진 추억지도 (아이폰 사진 앱의 지도처럼)
//  - 장소마다 "대표 사진 썸네일 + 사진 장수" 말풍선을 지도에 올려요.
//  - 가까운 장소는 하나로 묶이고(장수는 합계), 확대하면 풀려요.
//  - 말풍선을 누르면 그 장소(묶음이면 그 지역으로 확대)로 이동해요.
// 기존 BaseKakaoMap(핀 마커)은 그대로 두고, 추억지도에서만 이 컴포넌트를 써요.
// =========================================

export interface PhotoPin extends PinLike {
  name: string
  /** 대표 사진 주소 (없으면 사진 아이콘 자리표시) */
  thumb: string | null
}

/** 이 거리(px)보다 가까우면 한 묶음으로 보여줘요 (썸네일 크기 68px 기준) */
const CLUSTER_PX = 76
/** 두 장소가 이만큼(도) 이내로 붙어 있으면 더 확대해도 안 풀리니, 확대 대신 바로 선택해요 */
const SAME_SPOT_DEG = 0.0004

interface PhotoMapProps {
  pins: PhotoPin[]
  selectedPinId?: string
  onPinClick?: (pin: PhotoPin) => void
  height?: string
}

export default function PhotoMap({
  pins,
  selectedPinId,
  onPinClick,
  height = '540px',
}: PhotoMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstance = useRef<any>(null)
  // 화면에 올라가 있는 말풍선들 (묶음 key + 상태 → overlay). 바뀌지 않은 건 그대로 둬서 깜빡이지 않아요
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlays = useRef<Map<string, any>>(new Map())
  const pinsRef = useRef<PhotoPin[]>(pins)
  const selectedRef = useRef<string | undefined>(selectedPinId)
  const onPinClickRef = useRef(onPinClick)
  const lastFitKey = useRef('')
  const renderRef = useRef<() => void>(() => {})
  const [mapReady, setMapReady] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    onPinClickRef.current = onPinClick
  }, [onPinClick])

  // 1) 지도 만들기 + 확대/이동이 끝날 때마다 묶음 다시 계산
  useEffect(() => {
    let cancelled = false
    let cleanup: (() => void) | undefined
    loadKakao()
      .then((kakao) => {
        if (cancelled || !mapContainer.current) return
        const map = new kakao.maps.Map(mapContainer.current, {
          center: new kakao.maps.LatLng(37.5665, 126.978), // 기본: 서울시청 (종은 기본값)
          level: 7,
        })
        mapInstance.current = map
        const onIdle = () => renderRef.current()
        kakao.maps.event.addListener(map, 'idle', onIdle)
        cleanup = () => {
          kakao.maps.event.removeListener(map, 'idle', onIdle)
          overlays.current.forEach((o) => o.setMap(null))
          overlays.current = new Map()
        }
        setMapReady(true)
        setError('')
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [])

  // 2) 지금 화면(확대 단계)에서 묶음을 계산해 말풍선을 올리기
  useEffect(() => {
    renderRef.current = () => {
      const map = mapInstance.current
      if (!map) return
      const kakao = window.kakao
      const projection = map.getProjection()
      const project = (lat: number, lng: number) => {
        const p = projection.containerPointFromCoords(
          new kakao.maps.LatLng(lat, lng),
        )
        return { x: p.x as number, y: p.y as number }
      }
      const selectedId = selectedRef.current
      const clusters = clusterPins(pinsRef.current, project, CLUSTER_PX)

      const next = new Map<string, unknown>()
      for (const c of clusters) {
        const selected =
          selectedId != null && c.members.some((m) => m.id === selectedId)
        const sig = `${c.key}#${selected ? 1 : 0}#${c.count}#${c.cover.thumb ?? ''}`
        const kept = overlays.current.get(sig)
        if (kept) {
          next.set(sig, kept)
          overlays.current.delete(sig)
          continue
        }
        const overlay = new kakao.maps.CustomOverlay({
          map,
          position: new kakao.maps.LatLng(c.latitude, c.longitude),
          content: buildPin(c, selected, () => handleClick(c)),
          xAnchor: 0.5,
          yAnchor: 1, // 말풍선 꼬리 끝이 실제 좌표에 오도록
          zIndex: selected ? 30 : 10,
          clickable: true,
        })
        next.set(sig, overlay)
      }
      // 이번에 쓰이지 않은 이전 말풍선은 지도에서 내려요
      overlays.current.forEach((o) => o.setMap(null))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      overlays.current = next as Map<string, any>
    }

    function handleClick(c: Cluster<PhotoPin>) {
      const map = mapInstance.current
      if (!map) return
      if (c.members.length === 1) {
        onPinClickRef.current?.(c.members[0])
        return
      }
      // 여러 장소 묶음: 그 장소들이 모두 보이게 확대. 더 확대해도 안 풀릴 만큼 붙어 있으면 대표 장소를 바로 선택
      const lats = c.members.map((m) => m.latitude)
      const lngs = c.members.map((m) => m.longitude)
      const tiny =
        Math.max(...lats) - Math.min(...lats) < SAME_SPOT_DEG &&
        Math.max(...lngs) - Math.min(...lngs) < SAME_SPOT_DEG
      if (tiny || map.getLevel() <= 2) {
        onPinClickRef.current?.(c.cover)
        return
      }
      const kakao = window.kakao
      const bounds = new kakao.maps.LatLngBounds()
      c.members.forEach((m) =>
        bounds.extend(new kakao.maps.LatLng(m.latitude, m.longitude)),
      )
      map.setBounds(bounds, 110, 110, 110, 110)
    }
  }, [])

  // 3) 장소 목록이 바뀌면: 전체가 보이게 맞추고 다시 그리기
  useEffect(() => {
    pinsRef.current = pins
    const map = mapInstance.current
    if (!mapReady || !map) return
    const kakao = window.kakao

    const fitKey = pins
      .map((p) => `${p.id}:${p.latitude}:${p.longitude}`)
      .join('|')
    if (fitKey !== lastFitKey.current) {
      lastFitKey.current = fitKey
      if (pins.length > 0) {
        const bounds = new kakao.maps.LatLngBounds()
        pins.forEach((p) =>
          bounds.extend(new kakao.maps.LatLng(p.latitude, p.longitude)),
        )
        map.setBounds(bounds, 110, 90, 70, 90)
        if (pins.length === 1) map.setLevel(4)
      }
    }
    renderRef.current()
  }, [pins, mapReady])

  // 4) 선택이 바뀌면: 강조 표시 + 부드럽게 이동
  useEffect(() => {
    selectedRef.current = selectedPinId
    const map = mapInstance.current
    if (!mapReady || !map) return
    renderRef.current()
    const target = pinsRef.current.find((p) => p.id === selectedPinId)
    if (target)
      map.panTo(new window.kakao.maps.LatLng(target.latitude, target.longitude))
  }, [selectedPinId, mapReady])

  return (
    <div className="km-wrap">
      {error && <p className="km-error">{error}</p>}
      <div ref={mapContainer} style={{ height }} className="km-map" />
    </div>
  )
}

/** 말풍선 한 개 만들기 (사용자 글자는 textContent 로만 넣어서 안전해요) */
function buildPin(
  c: Cluster<PhotoPin>,
  selected: boolean,
  onClick: () => void,
) {
  const multi = c.members.length > 1
  const el = document.createElement('button')
  el.type = 'button'
  el.className = ['pm-pin', selected ? 'selected' : '', multi ? 'multi' : '']
    .filter(Boolean)
    .join(' ')
  const label = multi
    ? `장소 ${c.members.length}곳 · 사진 ${c.count}장`
    : `${c.cover.name} · 사진 ${c.count}장`
  el.setAttribute('aria-label', label)
  el.title = label

  if (selected && !multi) {
    const name = document.createElement('span')
    name.className = 'pm-name'
    name.textContent = c.cover.name
    el.appendChild(name)
  }

  const frame = document.createElement('span')
  frame.className = 'pm-frame'
  if (c.cover.thumb) {
    const img = document.createElement('img')
    img.className = 'pm-img'
    img.alt = ''
    img.draggable = false
    img.src = c.cover.thumb
    img.onerror = () => {
      img.remove()
      frame.classList.add('noimg')
    }
    frame.appendChild(img)
  } else {
    frame.classList.add('noimg')
  }
  if (c.count > 1) {
    const badge = document.createElement('span')
    badge.className = 'pm-count'
    badge.textContent = String(c.count)
    frame.appendChild(badge)
  }
  el.appendChild(frame)

  const tail = document.createElement('span')
  tail.className = 'pm-tail'
  el.appendChild(tail)

  el.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  return el
}
