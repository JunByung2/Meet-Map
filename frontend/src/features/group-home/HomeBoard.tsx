'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import type { Photo } from '@/lib/photos'
import Avatar from '@/components/Avatar'
import Panel from '@/components/Panel'
import GroupsMeetingCalendar from '@/features/calendar/GroupsMeetingCalendar'
import GroupChatPreview from './GroupChatPreview'
import css from './homeBoard.module.css'

type Meeting = {
  id: number
  group_id: number
  title: string
  location: string
  meeting_time: string
  status: string
  participant_ids?: number[]
}

type Member = {
  user_id: number
  nickname: string
  profile_image: string | null
}

type Me = {
  id: number
  nickname: string
}

const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
]

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
 * 그룹 홈 대시보드
 * - 약속 달력
 * - NEXT MEETING
 * - 빠른 실행
 * - 최근 추억
 * - 그룹 채팅 미리보기
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
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)

  // 최근 사진 불러오기
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

  // 현재 로그인한 사용자 확인
  useEffect(() => {
    let active = true

    api<Me>('/auth/me')
      .then((user) => {
        if (active) setCurrentUserId(user.id)
      })
      .catch(() => {
        if (active) setCurrentUserId(null)
      })

    return () => {
      active = false
    }
  }, [])

  // 최근 사진 4장
  const recent = [...(photos ?? [])]
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .slice(0, 4)

  // 다가오는 약속 개수
  const upcomingCount = (meetings ?? []).filter(
    (m) => m.status !== 'cancelled' && dayDiff(m.meeting_time) >= 0,
  ).length

  const when = nextMeeting ? new Date(nextMeeting.meeting_time) : null

  const diff = nextMeeting ? dayDiff(nextMeeting.meeting_time) : 0

  // ==========================================
  // NEXT MEETING 참석자 계산
  // ==========================================

  // 해당 약속에 지정된 참여자 ID
  const participantIds = new Set(nextMeeting?.participant_ids ?? [])

  // 그룹 멤버 중 해당 약속에 참여하는 사람
  const attendingMembers = members.filter((member) =>
    participantIds.has(member.user_id),
  )

  // 참석 인원
  const attendingCount = attendingMembers.length

  // 참석자로 지정되지 않은 인원
  const undecidedCount = Math.max(0, members.length - attendingCount)

  // 현재 로그인한 사용자의 참여 여부
  const isAttending =
    currentUserId !== null && participantIds.has(currentUserId)

  // 개인별 참석 상태 문구
  const attendanceLabel =
    currentUserId === null || participantIds.size === 0
      ? '미정이에요'
      : isAttending
        ? '참석할게!'
        : '불참할게!'

  return (
    <div className={css.board}>
      {/* ======================================
          1. 약속 달력
      ====================================== */}
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
          groups={[
            {
              id: group.id,
              name: group.name,
              icon: group.icon,
            },
          ]}
          meetings={meetings ?? []}
          selectionOnly
          dashboard
        />
      </Panel>

      {/* ======================================
          2. 중앙 영역
      ====================================== */}
      <div className={css.middle}>
        {/* NEXT MEETING */}
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
              {/* 약속 날짜와 기본 정보 */}
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
                  <h3>{nextMeeting.title}</h3>

                  <p>🕒 {timeText(nextMeeting.meeting_time)}</p>

                  {nextMeeting.location && <p>📍 {nextMeeting.location}</p>}
                </div>
              </div>

              {/* 참석자 프로필 및 인원 */}
              <div className={css.ticketPeople}>
                <div className={css.stack}>
                  {attendingMembers.slice(0, 5).map((m, i) => (
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
                  <b>{attendingCount}명 참석</b>
                  {' · '}
                  <b>{undecidedCount}명 미정</b>
                </span>
              </div>

              {/* 약속 관련 버튼 */}
              <div className={css.ticketActions}>
                <Link className="btn secondary sm" href={`${base}/meetings`}>
                  약속 보기
                </Link>

                <Link
                  className="btn secondary sm"
                  href={`${base}/map?view=transit`}
                >
                  경로 보기
                </Link>

                {/* 내 참석 상태 */}
                <Link className={css.burst} href={`${base}/meetings`}>
                  {attendanceLabel}
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

        {/* ======================================
            3. 빠른 실행
        ====================================== */}
        <Panel title="빠른 실행" kicker="QUICK ACTION" className={css.quick}>
          <div className={css.quickGrid}>
            <Link href={`${base}/meetings`}>📅 약속 만들기</Link>

            <Link href={`${base}/map?view=transit`}>📍 장소 찾기</Link>

            <Link href={`${base}/photos/upload`}>📷 사진 올리기</Link>

            <Link href={`${base}/chat`}>💬 대화하기</Link>
          </div>

          {/* 다가오는 약속 개수 유지 */}
          <div className={css.status}>
            <span className={css.pill}>예정</span>
            <b>다가오는 약속</b>
            <strong>{meetings === null ? '—' : `${upcomingCount}개`}</strong>
          </div>
        </Panel>
      </div>

      {/* ======================================
          4. 오른쪽 영역
      ====================================== */}
      <div className={css.right}>
        {/* 최근 추억 */}
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

                    <figcaption>
                      {p.title || p.caption || '함께한 순간'}
                    </figcaption>
                  </figure>
                </Link>
              ))}
            </div>
          ) : (
            <p className={css.empty}>
              {photos === null
                ? '불러오는 중…'
                : '아직 사진이 없어요. 첫 사진을 남겨 보세요.'}
            </p>
          )}
        </Panel>

        {/* 그룹 채팅 미리보기 */}
        <Panel
          title="그룹 채팅"
          kicker="LOBBY TALK"
          className={css.chat}
          action={
            <Link className="panel-action" href={`${base}/chat`}>
              전체 보기 →
            </Link>
          }
        >
          <GroupChatPreview groupId={group.id} />
        </Panel>
      </div>
    </div>
  )
}
