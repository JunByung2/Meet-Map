'use client'

import type { LocationErrorKind } from './types'

const MESSAGES: Record<LocationErrorKind, { title: string; body: string }> = {
  denied: {
    title: '위치 권한이 꺼져 있어요',
    body: "브라우저 주소창 옆 자물쇠(또는 사이트 설정)에서 위치를 '허용'으로 바꾼 뒤 다시 시도해 주세요. 휴대폰 설정에서 브라우저의 위치 권한이 꺼져 있을 수도 있어요.",
  },
  unavailable: {
    title: '위치를 확인할 수 없어요',
    body: 'GPS와 네트워크 연결을 확인하고 다시 시도해 주세요.',
  },
  timeout: {
    title: '위치 확인이 오래 걸려요',
    body: '실내라면 창가 쪽으로 이동하거나 잠시 후 다시 시도해 주세요.',
  },
  unsupported: {
    title: '이 브라우저는 위치 기능을 지원하지 않아요',
    body: '다른 브라우저(Chrome, Safari 등)로 열어 주세요.',
  },
}

type Props = {
  kind: LocationErrorKind
  onRetry: () => void
}

export default function LocationErrorGuide({ kind, onRetry }: Props) {
  const m = MESSAGES[kind]

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
      <p className="font-semibold text-red-700">{m.title}</p>
      <p className="mt-1 text-sm text-red-600">{m.body}</p>
      {kind !== 'unsupported' && (
        <button
          onClick={onRetry}
          className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm text-white"
        >
          다시 시도
        </button>
      )}
    </div>
  )
}
