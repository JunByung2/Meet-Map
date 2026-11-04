// 기존 우리 교통 로더를 재사용. 다현의 별도 SDK 로더는 복사하지 않는다.
import { loadMapSdk } from '@/features/transit/sdk'

export async function loadKakao() {
  await loadMapSdk()
  return window.kakao
}
