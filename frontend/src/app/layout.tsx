import type { Metadata, Viewport } from 'next'
import { Noto_Sans_KR, Do_Hyeon } from 'next/font/google'
import './globals.css'
import ScrollTopOnRoute from '@/components/ScrollTopOnRoute'
import RegisterServiceWorker from '@/components/RegisterServiceWorker'

const notoSansKr = Noto_Sans_KR({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-noto',
})

// 제목에 쓰는 글꼴
const doHyeon = Do_Hyeon({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-dohyeon',
})

export const metadata: Metadata = {
  title: '모여락',
  description: '친구들과 함께하는 약속과 기록',
  applicationName: '모여락',
  // 아이폰 홈 화면에 추가했을 때의 아이콘과 앱 모양
  icons: { apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: '모여락', statusBarStyle: 'black-translucent' },
}

// 폰 상단 바 색 (앱처럼 보이게)
export const viewport: Viewport = {
  themeColor: '#46302b',
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko" className={`${notoSansKr.variable} ${doHyeon.variable}`}>
      <body>
        <RegisterServiceWorker />
        <ScrollTopOnRoute />
        {children}
      </body>
    </html>
  )
}
