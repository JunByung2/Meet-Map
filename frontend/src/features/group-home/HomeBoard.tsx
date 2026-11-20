'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import type { Photo } from '@/lib/photos'
import Avatar from '@/components/Avatar'
import Panel from '@/components/Panel'
import GroupsMeetingCalendar from '@/features/calendar/GroupsMeetingCalendar'
import css from './homeBoard.module.css'

type Meeting = {
  id: number
  group_id: number
  title: string
  location: string
  meeting_time: string
  status: string
}

type Member = {
  user_id: number
  nickname: string
  profile_image: string | null
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const WEEK = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const TONES = ['', 'peach', 'lavender']

function dayDiff(iso: string) {
  const d = new Date(iso)
  const n = new Date()
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const b = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()
  return Math.round((a - b) / 86400000)
}

function timeText(iso: string) {
  return new Date(iso).toLocaleTimeString('ko-KR', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * 그룹 홈 맨 위 3열: 약속 달력 / 다음 약속 티켓 + 빠른 실행 / 최근 추억 + 채팅 바로가기
 */
export default function HomeBoard({
  group,
  members,
  meetings,
  nextMeeting,
}: {
  group: { id: number; name: string; icon: string | null }
  members: Member[]
  meetings: Meeting[] | null
  nextMeeting: Meeting | undefined
}) {
  const base = `/groups/${group.id}`
  const [photos, setPhotos] = useState<Photo[] | null>(null)

  useEffect(() => {
    let active = true
    api<Photo[]>(`${base}/photos`)
      .then((list) => {
        if (active) setPhotos(list)
      })
      .catch(() => {
        if (active) setPhotos([])
      })
    return () => {
      active = false
    }
  }, [base])

  const recent = [...(photos ?? [])]
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .slice(0, 4)
  const upcomingCount = (meetings ?? []).filter(
    (m) => m.status !== 'cancelled' && dayDiff(m.meeting_time) >= 0,
  ).length

  const when = nextMeeting ? new Date(nextMeeting.meeting_time) : null
  const diff = nextMeeting ? dayDiff(nextMeeting.meeting_time) : 0

  return (
    <div className={css.board}>
      <Panel
        title="약속 달력"
        kicker="SCHEDULE"
        className={css.calendar}
        action={
          <Link className="panel-action" href={`${base}/meetings`}>
            + 약속 만들기
          </Link>
        }
      >
        <GroupsMeetingCalendar
          groups={[{ id: group.id, name: group.name, icon: group.icon }]}
          meetings={meetings ?? []}
        />
      </Panel>

      <div className={css.middle}>
        <article className={css.ticket}>
          <div className={css.ticketTop}>
            <span>NEXT MEETING</span>
            <small>
              {nextMeeting ? (diff <= 0 ? 'TODAY' : `D-${diff}`) : '—'}
            </small>
          </div>
          {meetings === null ? (
            <p className={css.ticketEmpty}>불러오는 중…</p>
          ) : nextMeeting && when ? (
            <>
              <div className={css.ticketContent}>
                <div className={css.ticketDate}>
                  <b>{when.getDate()}</b>
                  <span>
                    {MONTHS[when.getMonth()]}
                    <br />
                    {WEEK[when.getDay()]}
                  </span>
                </div>
                <div className={css.ticketCopy}>
                  <span className="eyebrow">{group.name}</span>
                  <h3>{nextMeeting.title}</h3>
                  <p>🕒 {timeText(nextMeeting.meeting_time)}</p>
                  {nextMeeting.location && <p>📍 {nextMeeting.location}</p>}
                </div>
              </div>
              <div className={css.ticketPeople}>
                <div className={css.stack}>
                  {members.slice(0, 5).map((m, i) => (
                    <Avatar
                      key={m.user_id}
                      userId={m.user_id}
                      name={m.nickname}
                      image={m.profile_image}
                      size="sm"
                      tone={TONES[i % TONES.length]}
                    />
                  ))}
                </div>
                <span>
                  <b>{members.length}명</b> 함께해요
                </span>
              </div>
              <div className={css.ticketActions}>
                <Link className="btn secondary sm" href={`${base}/meetings`}>
                  약속 보기
                </Link>
                <Link className="btn secondary sm" href={`${base}/map?view=transit`}>
                  경로 보기
                </Link>
                <Link className={css.burst} href={`${base}/chat`}>
                  채팅 가기
                </Link>
              </div>
            </>
          ) : (
            <div className={css.ticketEmpty}>
              <p>아직 예정된 약속이 없어요.</p>
              <Link className="btn sm" href={`${base}/meetings`}>
                + 약속 만들기
              </Link>
            </div>
          )}
        </article>

        <Panel title="빠른 실행" kicker="QUICK ACTION" className={css.quick}>
          <div className={css.quickGrid}>
            <Link href={`${base}/meetings`}>📅 약속 만들기</Link>
            <Link href={`${base}/map?view=transit`}>📍 장소 찾기</Link>
            <Link href={`${base}/photos/upload`}>📷 사진 올리기</Link>
            <Link href={`${base}/chat`}>💬 대화하기</Link>
          </div>
          <div className={css.status}>
            <span className={css.pill}>예정</span>
            <b>다가오는 약속</b>
            <strong>{meetings === null ? '—' : `${upcomingCount}개`}</strong>
          </div>
        </Panel>
      </div>

      <div className={css.right}>
        <Panel
          title="최근 추억"
          kicker="OUR MEMORIES"
          className={css.memories}
          action={
            <Link className="panel-action" href={`${base}/memories`}>
              더 보기 →
            </Link>
          }
        >
          {recent.length > 0 ? (
            <div className={css.photoGrid}>
              {recent.map((p) => (
                <Link key={p.id} href={`${base}/photos/${p.id}`}>
                  <figure>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.signed_url || p.url || ''}
                      alt={p.title || p.caption || '그룹 사진'}
                      loading="lazy"
                      decoding="async"
                    />
                    <figcaption>{p.title || p.caption || '함께한 순간'}</figcaption>
                  </figure>
                </Link>
              ))}
            </div>
          ) : (
            <p className={css.empty}>
              {photos === null ? '불러오는 중…' : '아직 사진이 없어요. 첫 사진을 남겨 보세요.'}
            </p>
          )}
        </Panel>

        <Panel title="그룹 채팅" kicker="LOBBY TALK" className={css.chat}>
          <p className={css.chatText}>
            만날 장소와 시간을 친구들과 함께 정해 보세요.
          </p>
          <Link className="btn sm block" href={`${base}/chat`}>
            채팅 열기
          </Link>
        </Panel>
      </div>
    </div>
  )
}
