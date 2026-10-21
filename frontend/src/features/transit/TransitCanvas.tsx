'use client'

import { useEffect, useRef, useState } from 'react'
import { loadMapSdk } from './sdk'
import type { Place, TransitRoute } from './types'
import styles from './transit.module.css'

interface MapHandle {
  setBounds: (bounds: unknown) => void
  setCenter: (point: unknown) => void
  setLevel: (level: number) => void
  relayout: () => void
}
interface OverlayHandle { setMap: (map: null) => void }

export default function TransitCanvas({ origin, destination, route }: {
  origin: Place | null
  destination: Place | null
  route: TransitRoute | null
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapHandle | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    let observer: ResizeObserver | undefined
    loadMapSdk().then(() => {
      if (cancelled || !container.current) return
      const k = window.kakao.maps
      const instance: MapHandle = new k.Map(container.current, {
        center: new k.LatLng(37.5665, 126.978), level: 7,
      })
      map.current = instance
      observer = new ResizeObserver(() => instance.relayout())
      observer.observe(container.current)
      setReady(true)
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : '지도 로딩 실패')
    })
    return () => { cancelled = true; observer?.disconnect(); map.current = null }
  }, [])

  useEffect(() => {
    if (!ready || !map.current) return
    const k = window.kakao.maps
    const instance = map.current
    const bounds = new k.LatLngBounds()
    const overlays: OverlayHandle[] = []
    let count = 0
    const extend = (x: number, y: number) => {
      const point = new k.LatLng(y, x)
      bounds.extend(point)
      count += 1
      return point
    }
    ;[origin, destination].forEach((place, index) => {
      if (!place) return
      const position = extend(place.longitude, place.latitude)
      const label = document.createElement('div')
      label.className = styles.pin
      label.style.background = index === 0 ? '#247c73' : '#bb653c'
      label.textContent = `${index === 0 ? '출발' : '도착'} · ${place.name}`
      overlays.push(new k.CustomOverlay({ map: instance, position, content: label, yAnchor: 1.4, zIndex: 10 }))
    })
    route?.steps.forEach((step) => {
      if (step.points.length < 2) return
      const path = step.points.map(([x, y]) => extend(x, y))
      overlays.push(new k.Polyline({
        map: instance, path,
        strokeWeight: step.mode === 'WALKING' ? 4 : 6,
        strokeColor: step.mode === 'BUS' ? '#2786bb' : step.mode === 'SUBWAY' ? '#7960b2' : '#7f8c88',
        strokeOpacity: 0.9,
        strokeStyle: step.mode === 'WALKING' ? 'shortdash' : 'solid',
      }))
    })
    if (count === 1) {
      const place = origin ?? destination
      if (place) instance.setCenter(new k.LatLng(place.latitude, place.longitude))
      instance.setLevel(4)
    } else if (count > 1) instance.setBounds(bounds)
    return () => overlays.forEach((overlay) => overlay.setMap(null))
  }, [origin, destination, route, ready])

  return <div className={styles.mapBox}>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.canvas} ref={container} aria-label="대중교통 경로 지도" />
  </div>
}
