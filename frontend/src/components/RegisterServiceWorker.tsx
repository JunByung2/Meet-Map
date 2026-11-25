'use client'

import { useEffect } from 'react'

// 서비스 워커 등록 (배포 환경에서만. 개발 중에는 화면이 저장돼서 헷갈리지 않게 끈다)
export default function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])
  return null
}
