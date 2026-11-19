import type { Metadata } from 'next'
import { Noto_Sans_KR, Do_Hyeon } from 'next/font/google'
import './globals.css'
import ScrollTopOnRoute from '@/components/ScrollTopOnRoute'

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
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko" className={`${notoSansKr.variable} ${doHyeon.variable}`}>
      <body>
        <ScrollTopOnRoute />
        {children}
      </body>
    </html>
  )
}
