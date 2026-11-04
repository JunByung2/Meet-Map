'use client'

import { useState } from 'react'
import type { Coords } from './types'

// 대략적인 예시 좌표 (필요하면 팀 시드 데이터에 맞춰 수정)
const PRESETS: { name: string; coords: Coords }[] = [
  { name: '홍대입구역 근처', coords: { lat: 37.5572, lng: 126.9245 } },
  { name: '강남역 근처', coords: { lat: 37.4979, lng: 127.0276 } },
  { name: '서울역 근처', coords: { lat: 37.5547, lng: 126.9707 } },
]

type Props = {
  onPick: (c: Coords) => void
}

export default function SimulatorPanel({ onPick }: Props) {
  const [lat, setLat] = useState('37.5572')
  const [lng, setLng] = useState('126.9245')
  const [msg, setMsg] = useState<string | null>(null)

  // 환경변수가 꺼져 있으면 화면에 아무것도 안 보임
  if (process.env.NEXT_PUBLIC_ENABLE_LOCATION_SIM !== 'true') return null

  const submit = () => {
    const la = Number(lat)
    const ln = Number(lng)
    if (
      lat.trim() === '' ||
      lng.trim() === '' ||
      Number.isNaN(la) ||
      Number.isNaN(ln) ||
      Math.abs(la) > 90 ||
      Math.abs(ln) > 180
    ) {
      setMsg('좌표를 확인해 주세요 (위도 -90~90, 경도 -180~180)')
      return
    }
    setMsg(null)
    onPick({ lat: la, lng: ln })
  }

  return (
    <div className="rounded-xl border border-dashed border-gray-400 p-4">
      <p className="text-sm font-semibold text-gray-600">
        🛠 개발용 위치 시뮬레이터
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            onClick={() => {
              setMsg(null)
              onPick(p.coords)
            }}
            className="rounded-lg bg-gray-100 px-3 py-1 text-sm text-gray-800"
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          placeholder="위도"
          inputMode="decimal"
          className="w-28 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
        />
        <input
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          placeholder="경도"
          inputMode="decimal"
          className="w-28 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
        />
        <button
          onClick={submit}
          className="rounded bg-gray-800 px-3 py-1 text-sm text-white"
        >
          좌표 보내기
        </button>
      </div>

      {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}
    </div>
  )
}
