let pending: Promise<void> | undefined

export function loadMapSdk(): Promise<void> {
  if (pending) return pending
  pending = new Promise<void>((resolve, reject) => {
    const key = process.env.NEXT_PUBLIC_KAKAO_JS_KEY
    if (!key) { reject(new Error('지도 JavaScript 키를 설정해 주세요.')); return }
    const ready = () => {
      if (!window.kakao?.maps?.load) {
        reject(new Error('지도 SDK를 초기화하지 못했어요.')); return
      }
      window.kakao.maps.load(() => resolve())
    }
    if (window.kakao?.maps?.load) { ready(); return }
    let script = document.getElementById('kakao-map-sdk') as HTMLScriptElement | null
    const isNew = !script
    if (!script) {
      script = document.createElement('script')
      script.id = 'kakao-map-sdk'
      script.async = true
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false&libraries=services`
    }
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('지도 로딩 시간이 초과됐어요. 새로고침해 주세요.'))
    }, 20000)
    const cleanup = () => {
      window.clearTimeout(timer)
      script?.removeEventListener('load', onLoad)
      script?.removeEventListener('error', onError)
    }
    const onLoad = () => { cleanup(); ready() }
    const onError = () => { cleanup(); reject(new Error('지도를 불러오지 못했어요.')) }
    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
    if (isNew) document.head.appendChild(script)
  }).catch((error: unknown) => { pending = undefined; throw error })
  return pending
}
