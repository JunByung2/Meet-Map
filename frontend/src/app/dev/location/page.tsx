'use client'

import { useGeolocation } from '@/features/location/useGeolocation'
import LocationErrorGuide from '@/features/location/LocationErrorGuide'
import SimulatorPanel from '@/features/location/SimulatorPanel'

export default function LocationDevPage() {
  const { status, coords, error, source, request, setSimulated } =
    useGeolocation()

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-xl font-bold">위치 테스트</h1>

      <button
        onClick={request}
        disabled={status === 'requesting'}
        className="w-full rounded-xl bg-blue-600 py-3 text-white disabled:opacity-50"
      >
        {status === 'requesting' ? '확인 중…' : '내 위치 가져오기'}
      </button>

      {status === 'error' && error && (
        <LocationErrorGuide kind={error} onRetry={request} />
      )}

      {status === 'success' && coords && (
        <div className="rounded-xl border p-4 text-sm">
          <p>
            출처: <b>{source === 'simulated' ? '시뮬레이터' : '실제 위치'}</b>
          </p>
          <p>위도: {coords.lat.toFixed(5)}</p>
          <p>경도: {coords.lng.toFixed(5)}</p>
          {coords.accuracy != null && (
            <p>정확도: 약 {Math.round(coords.accuracy)}m</p>
          )}
        </div>
      )}

      <SimulatorPanel onPick={setSimulated} />
    </main>
  )
}
