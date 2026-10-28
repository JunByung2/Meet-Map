export type Coords = { lat: number; lng: number; accuracy?: number }

export type LocationStatus = 'idle' | 'requesting' | 'success' | 'error'

export type LocationErrorKind =
  | 'denied' // 권한 거부
  | 'unavailable' // GPS/네트워크 문제
  | 'timeout' // 시간 초과
  | 'unsupported' // 브라우저가 위치 기능 없음
