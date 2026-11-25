'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import css from './landing.module.css'

const FEATURES = [
  {
    kicker: 'PLAN',
    title: '약속 정하기',
    text: '달력에서 가능한 날을 모으고, 투표로 시간과 장소를 확정해요.',
    icon: '📅',
  },
  {
    kicker: 'MEET MODE',
    title: '같이 가기',
    text: '약속 당일에는 누가 도착했는지, 누가 오는 중인지 한눈에 봐요.',
    icon: '📍',
  },
  {
    kicker: 'MEMORY',
    title: '추억 남기기',
    text: '함께 찍은 사진과 장소를 지도에 차곡차곡 쌓아 둬요.',
    icon: '📷',
  },
]

const DEMO_PEOPLE = ['하', '민', '서', '준']

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    let active = true
    api('/auth/me')
      .then(() => {
        if (active) router.replace('/groups')
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [router])

  return (
    <div className={css.page}>
      <header className={css.top}>
        <Link href="/" className={css.brand}>
          <i />
          <span>모여락</span>
          <i />
        </Link>
        <nav className={css.topNav} aria-label="계정">
          <Link href="/login" className="btn secondary sm">
            로그인
          </Link>
          <Link href="/signup" className="btn sm">
            회원가입
          </Link>
        </nav>
      </header>

      <main>
        <section className={css.hero}>
          <div className={css.copy}>
            <p className="eyebrow">MEET · GO · REMEMBER</p>
            <h1>
              약속 잡고, 같이 가고,
              <br />
              추억 남기기
            </h1>
            <p className={css.lead}>
              친구들과의 약속을 한곳에서. 날짜를 맞추고, 만나는 길을 함께
              확인하고, 그날의 사진까지 지도에 남겨요.
            </p>
            <div className={css.cta}>
              <Link href="/login" className="btn">
                시작하기
              </Link>
              <Link href="/signup" className="btn secondary">
                처음이에요
              </Link>
            </div>
          </div>

          <div className={css.demo} aria-label="모여락 화면 미리보기">
            <span className={css.demoTag}>미리보기</span>
            <article className={css.ticket}>
              <div className={css.ticketTop}>
                <span>NEXT MEETING</span>
                <small>D-3</small>
              </div>
              <div className={css.ticketContent}>
                <div className={css.ticketDate}>
                  <b>28</b>
                  <span>
                    NOV
                    <br />
                    SAT
                  </span>
                </div>
                <div className={css.ticketCopy}>
                  <span className="eyebrow">우리 모임</span>
                  <h2>주말 모임</h2>
                  <p>🕒 오후 5:00</p>
                  <p>📍 삼송역 3호선</p>
                </div>
              </div>
              <div className={css.ticketPeople}>
                <div className={css.stack} aria-hidden="true">
                  {DEMO_PEOPLE.map((p, i) => (
                    <span key={p} className={css[`tone${i % 3}`]}>
                      {p}
                    </span>
                  ))}
                </div>
                <span>
                  <b>4명</b> 함께해요
                </span>
              </div>
              <div className={css.ticketBar} aria-hidden="true">
                {[
                  ['하 · 도착', 100],
                  ['민 · 1.2km', 62],
                  ['서 · 3.8km', 20],
                ].map(([label, pct]) => (
                  <div key={label} className={css.barRow}>
                    <em>{label}</em>
                    <b>
                      <i style={{ width: `${pct}%` }} />
                    </b>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>

        <section className={css.features} aria-label="주요 기능">
          {FEATURES.map((f) => (
            <article key={f.title} className="panel">
              <header className="panel-head">
                <div>
                  <span className="panel-kicker">{f.kicker}</span>
                  <h2>{f.title}</h2>
                </div>
                <span className={css.featureIcon} aria-hidden="true">
                  {f.icon}
                </span>
              </header>
              <div className="panel-body">
                <p className={css.featureText}>{f.text}</p>
              </div>
            </article>
          ))}
        </section>

        <section className={css.bottom}>
          <h2>이제 약속 장소 고르느라 단톡방에서 헤매지 말아요</h2>
          <Link href="/login" className="btn">
            모여락 시작하기
          </Link>
        </section>
      </main>

      <footer className={css.footer}>
        <span>© 모여락</span>
        <Link href="/privacy">개인정보 처리방침</Link>
      </footer>
    </div>
  )
}
