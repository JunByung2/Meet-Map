import type { MetadataRoute } from 'next'

// 홈 화면에 추가했을 때 앱처럼 보이게 하는 설정 파일 (/manifest.webmanifest 로 자동 제공)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '모여락',
    short_name: '모여락',
    description: '친구들과 함께하는 약속과 기록',
    lang: 'ko',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f5ebdd',
    theme_color: '#46302b',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
