import type { TransitRoute } from './types'

export interface TransferWalk {
  boardingStep: number
  from: string
  to: string
  mode: string
  seconds: number | null
  distance: number | null
}

export interface TransferEstimate {
  status: 'unknown' | 'stale' | 'miss' | 'tight' | 'comfortable'
  label: string
  remainingWalkSeconds: number | null
  busArrivalSeconds: number | null
  marginSeconds: number | null
  usableMarginSeconds: number | null
}

const transit = (mode: string) => mode === 'BUS' || mode === 'SUBWAY'

export function getTransferWalks(route: TransitRoute): TransferWalk[] {
  const transfers: TransferWalk[] = []
  let previous = -1
  route.steps.forEach((step, index) => {
    if (!transit(step.mode)) return
    if (previous >= 0) {
      const between = route.steps.slice(previous + 1, index)
      const walking = between.filter((part) => part.mode === 'WALKING')
      // 도보 구간이 없으면 실제 0초인지 누락인지 알 수 없으므로 미제공으로 처리.
      const seconds = walking.length && between.every((part) => part.mode === 'WALKING')
        && walking.every((part) => part.seconds !== null)
        ? walking.reduce((sum, part) => sum + part.seconds!, 0) : null
      const distance = walking.length && walking.every((part) => part.distance !== null)
        ? walking.reduce((sum, part) => sum + part.distance!, 0) : null
      const previousStep = route.steps[previous]
      transfers.push({
        boardingStep: index,
        from: previousStep.stops[previousStep.stops.length - 1] ?? '직전 하차 지점',
        to: step.stops[0] ?? '다음 승차 지점',
        mode: step.mode, seconds, distance,
      })
    }
    previous = index
  })
  return transfers
}

// 미래 환승 지점에 대한 단순 합산 예측 대신, 현재부터 승차 지점까지 걸리는
// 시간과 동일 기준시각의 실제 도착 관측을 전달받아 계산한다.
export function estimateTransfer(input: {
  nowMs: number
  observedAtMs: number | null
  busArrivalAtMs: number | null
  remainingToStopSeconds: number | null
  bufferSeconds?: number
  maxAgeSeconds?: number
}): TransferEstimate {
  const unknown = (status: TransferEstimate['status'], label: string): TransferEstimate => ({
    status, label, remainingWalkSeconds: null, busArrivalSeconds: null,
    marginSeconds: null, usableMarginSeconds: null,
  })
  const { nowMs, observedAtMs, busArrivalAtMs, remainingToStopSeconds } = input
  const buffer = input.bufferSeconds ?? 60
  const maxAge = input.maxAgeSeconds ?? 60
  if (![nowMs, observedAtMs, busArrivalAtMs, remainingToStopSeconds, buffer, maxAge]
    .every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return unknown('unknown', '도착 정보와 현재 위치 기준 이동시간이 필요해요.')
  }
  if (remainingToStopSeconds! < 0 || buffer < 0 || maxAge < 0) {
    return unknown('unknown', '이동시간 정보가 올바르지 않아요.')
  }
  const age = (nowMs - observedAtMs!) / 1000
  if (age < 0 || age > maxAge) return unknown('stale', '도착 정보를 새로 조회해 주세요.')
  const busSeconds = (busArrivalAtMs! - nowMs) / 1000
  if (busSeconds < 0) return unknown('stale', '이 버스의 예상 도착시각이 지났어요.')
  const margin = busSeconds - remainingToStopSeconds!
  const usableMargin = margin - buffer
  const status = usableMargin < 0 ? 'miss' : usableMargin < 180 ? 'tight' : 'comfortable'
  return {
    status,
    label: status === 'miss' ? '탑승이 어려울 수 있어요'
      : status === 'tight' ? '환승 시간이 촉박해요' : '비교적 여유가 있어요',
    remainingWalkSeconds: remainingToStopSeconds,
    busArrivalSeconds: busSeconds,
    marginSeconds: margin,
    usableMarginSeconds: usableMargin,
  }
}
