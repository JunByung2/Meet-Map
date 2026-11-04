'use client'

import { useCallback, useState } from 'react'
import type { Coords, LocationErrorKind, LocationStatus } from './types'

export function useGeolocation() {
  const [status, setStatus] = useState<LocationStatus>('idle')
  const [coords, setCoords] = useState<Coords | null>(null)
  const [error, setError] = useState<LocationErrorKind | null>(null)
  const [source, setSource] = useState<'real' | 'simulated' | null>(null)

  // 진짜 위치 요청 (브라우저 권한 팝업이 뜸)
  const request = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setError('unsupported')
      setStatus('error')
      return
    }

    setStatus('requesting')
    setError(null)

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        })
        setSource('real')
        setStatus('success')
      },
      (err) => {
        const kind: LocationErrorKind =
          err.code === err.PERMISSION_DENIED
            ? 'denied'
            : err.code === err.TIMEOUT
              ? 'timeout'
              : 'unavailable'
        setError(kind)
        setStatus('error')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  }, [])

  // 화요일 시뮬레이터가 가짜 좌표를 넣는 통로 (월요일엔 안 써도 됨)
  const setSimulated = useCallback((c: Coords) => {
    setCoords(c)
    setSource('simulated')
    setError(null)
    setStatus('success')
  }, [])

  return { status, coords, error, source, request, setSimulated }
}
