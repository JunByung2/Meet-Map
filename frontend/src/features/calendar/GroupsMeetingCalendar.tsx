'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import css from './groupsCalendar.module.css'

type GroupLite = {
  id: number
  name: string
  icon: string | null
}

type MeetingLite = {
  id: number
  group_id: number
  title: string
  location: string
  meeting_time: string
  status: string
}

type CalendarProps = {
  groups: GroupLite[]
  meetings?: MeetingLite[]
  listHref?: string
  dashboard?: boolean
  /** true면 모바일(650px 이하)에서 달력 칸 높이를 낮춘다. 모든 칸이 같은 높이로 줄어든다. */
  compactMobile?: boolean
  /** true면 날짜를 선택했을 때만 달력 아래 상세 목록을 보여준다. */
  selectionOnly?: boolean
}

const COLORS = [
  '#1FA58A',
  '#3B82F6',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#F97316',
  '#84CC16',
  '#64748B',
]

const DOW = ['일', '월', '화', '수', '목', '금', '토']
const MAX_CHIPS = 2

const pad = (n: number) => String(n).padStart(2, '0')

const ymd = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

function parseDay(day: string) {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date)
}

function dayLabel(day: string) {
  const date = parseDay(day)

  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${DOW[date.getDay()]})`
}

function timeLabel(iso: string) {
  const date = new Date(iso)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const seoulDayFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul',
})

export default function GroupsMeetingCalendar({
  groups,
  meetings: given,
  listHref,
  dashboard = false,
  compactMobile = false,
  selectionOnly = false,
}: CalendarProps) {
  const todayKey = ymd(new Date())

  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  const [fetched, setFetched] = useState<MeetingLite[]>([])
  const [loadingOwn, setLoadingOwn] = useState(true)
  const [failed, setFailed] = useState(0)
  const [hidden, setHidden] = useState<number[]>([])
  const [selected, setSelected] = useState<string | null>(null)

  const groupKey = groups.map((group) => group.id).join(',')
  const hasGivenMeetings = given !== undefined

  const meetings = given ?? fetched
  const loading = hasGivenMeetings ? false : loadingOwn

  // 부모가 약속을 전달하면 중복 조회하지 않는다.
  useEffect(() => {
    if (hasGivenMeetings) return

    let cancelled = false

    const groupIds = groupKey ? groupKey.split(',').map(Number) : []

    setLoadingOwn(true)
    setFailed(0)
    setFetched([])

    Promise.allSettled(
      groupIds.map((id) => api<MeetingLite[]>(`/groups/${id}/meetings`)),
    ).then((results) => {
      if (cancelled) return

      const all: MeetingLite[] = []
      let failedCount = 0

      for (const result of results) {
        if (result.status === 'fulfilled') {
          all.push(...result.value)
        } else {
          failedCount += 1
        }
      }

      setFetched(all)
      setFailed(failedCount)
      setLoadingOwn(false)
    })

    return () => {
      cancelled = true
    }
  }, [groupKey, hasGivenMeetings])

  const colorOf = (groupId: number) => {
    const index = groups.findIndex((group) => group.id === groupId)
    return COLORS[(index < 0 ? 0 : index) % COLORS.length]
  }

  const nameOf = (groupId: number) =>
    groups.find((group) => group.id === groupId)?.name ?? ''

  // 확정된 약속을 날짜별로 묶는다.
  const byDay = useMemo(() => {
    const map = new Map<string, MeetingLite[]>()

    for (const meeting of meetings) {
      if (meeting.status?.toLowerCase() !== 'confirmed') continue
      if (hidden.includes(meeting.group_id)) continue

      const date = new Date(meeting.meeting_time)
      if (Number.isNaN(date.getTime())) continue

      const key = ymd(date)
      const list = map.get(key) ?? []

      list.push(meeting)
      map.set(key, list)
    }

    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(a.meeting_time).getTime() -
          new Date(b.meeting_time).getTime(),
      )
    }

    return map
  }, [meetings, hidden])

  const year = month.getFullYear()
  const monthIdx = month.getMonth()
  const startOffset = new Date(year, monthIdx, 1).getDay()
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate()

  // 홈에서는 이번 달에 필요한 4~6주만 표시한다.
  // 다른 화면은 기존처럼 6주를 유지한다.
  const weekCount = dashboard ? Math.ceil((startOffset + daysInMonth) / 7) : 6

  const cells = Array.from({ length: weekCount * 7 }, (_, index) => {
    const date = new Date(year, monthIdx, 1 - startOffset + index)

    return {
      key: ymd(date),
      date,
      inMonth: date.getMonth() === monthIdx,
    }
  })

  function shift(delta: number) {
    setMonth(new Date(year, monthIdx + delta, 1))
    setSelected(null)
  }

  function goToday() {
    const now = new Date()

    setMonth(new Date(now.getFullYear(), now.getMonth(), 1))
    setSelected(null)
  }

  const selectedMeetings = selected ? (byDay.get(selected) ?? []) : []

  // 오늘 이후 약속 중 가까운 5개
  const upcoming = useMemo(() => {
    const list: MeetingLite[] = []

    for (const [key, items] of byDay) {
      if (key >= todayKey) list.push(...items)
    }

    list.sort(
      (a, b) =>
        new Date(a.meeting_time).getTime() - new Date(b.meeting_time).getTime(),
    )

    return list.slice(0, 5)
  }, [byDay, todayKey])

  const calendarStyle = dashboard
    ? ({
        '--calendar-weeks': weekCount,
      } as CSSProperties)
    : undefined

  function meetingHref(meeting: MeetingLite) {
    const meetingDay = seoulDayFormatter.format(new Date(meeting.meeting_time))
    const today = seoulDayFormatter.format(new Date())

    if (meetingDay < today) {
      return `/groups/${meeting.group_id}/meeting-record/${meeting.id}`
    }

    return listHref ?? `/groups/${meeting.group_id}/meetings`
  }

  function renderMeeting(meeting: MeetingLite, withDate: boolean) {
    return (
      <Link
        key={`${meeting.group_id}-${meeting.id}`}
        href={meetingHref(meeting)}
        className={css.item}
        style={
          {
            '--c': colorOf(meeting.group_id),
          } as CSSProperties
        }
      >
        <span className={css.itemBar} />

        <span className={css.itemBody}>
          <strong>{meeting.title}</strong>

          <span className="muted">
            {withDate
              ? `${dayLabel(ymd(new Date(meeting.meeting_time)))} `
              : ''}
            {timeLabel(meeting.meeting_time)}
            {' · '}
            {nameOf(meeting.group_id)}
            {meeting.location ? ` · 📍 ${meeting.location}` : ''}
          </span>
        </span>

        <span className="link-arrow" aria-hidden="true">
          →
        </span>
      </Link>
    )
  }

  return (
    <div
      className={`${css.wrap} ${dashboard ? css.dashboard : ''} ${compactMobile ? css.compactMobile : ''}`}
      data-selected={selected ? 'true' : 'false'}
      style={calendarStyle}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setSelected(null)
        }
      }}
    >
      <div className={css.head}>
        <div className={css.month}>
          <button
            type="button"
            className={css.nav}
            onClick={() => shift(-1)}
            aria-label="이전 달"
          >
            ‹
          </button>

          <span className={css.monthLabel}>
            {year}년 {monthIdx + 1}월
          </span>

          <button
            type="button"
            className={css.nav}
            onClick={() => shift(1)}
            aria-label="다음 달"
          >
            ›
          </button>
        </div>

        <button type="button" className="btn secondary sm" onClick={goToday}>
          오늘
        </button>
      </div>

      {/* 그룹 이름을 누르면 해당 그룹의 약속 표시를 전환한다. */}
      {groups.length > 1 && (
        <div className={css.legend}>
          {groups.map((group) => {
            const off = hidden.includes(group.id)

            return (
              <button
                key={group.id}
                type="button"
                className={`${css.who} ${off ? css.whoOff : ''}`}
                aria-pressed={!off}
                onClick={() => {
                  setHidden((current) =>
                    current.includes(group.id)
                      ? current.filter((id) => id !== group.id)
                      : [...current, group.id],
                  )
                }}
              >
                <i
                  className={css.dot}
                  style={{ background: colorOf(group.id) }}
                  aria-hidden="true"
                />
                {group.name}
              </button>
            )
          })}
        </div>
      )}

      {!hasGivenMeetings && failed > 0 && (
        <p className="muted" role="status">
          그룹 {failed}곳의 약속은 불러오지 못했어요. 새로고침해 보세요.
        </p>
      )}

      <div className={`${css.body} ${selectionOnly ? css.selectionOnly : ''}`}>
        <div className={css.grid} aria-busy={loading}>
          {DOW.map((day, index) => (
            <div
              key={day}
              className={[
                css.dow,
                index === 0 ? css.sun : '',
                index === 6 ? css.sat : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {day}
            </div>
          ))}

          {cells.map(({ key, date, inMonth }) => {
            const list = byDay.get(key) ?? []

            const classes = [
              css.cell,
              inMonth ? '' : css.out,
              key === todayKey ? css.today : '',
              key === selected ? css.selected : '',
            ]
              .filter(Boolean)
              .join(' ')

            const summary =
              `${date.getMonth() + 1}월 ${date.getDate()}일` +
              (list.length
                ? `, 약속 ${list
                    .map(
                      (meeting) =>
                        `${nameOf(meeting.group_id)} ${meeting.title}`,
                    )
                    .join(', ')}`
                : ', 약속 없음')

            return (
              <button
                key={key}
                type="button"
                className={classes}
                onClick={() => setSelected(key)}
                aria-label={summary}
                aria-pressed={selected === key}
                title={summary}
              >
                <span className={css.num}>{date.getDate()}</span>

                {list.slice(0, MAX_CHIPS).map((meeting) => (
                  <span
                    key={`${meeting.group_id}-${meeting.id}`}
                    className={css.chip}
                    style={
                      {
                        '--c': colorOf(meeting.group_id),
                      } as CSSProperties
                    }
                  >
                    {meeting.title}
                  </span>
                ))}

                {list.length > MAX_CHIPS && (
                  <span className={css.more}>+{list.length - MAX_CHIPS}</span>
                )}

                {list.length > 0 && (
                  <span className={css.dots} aria-hidden="true">
                    {list.slice(0, 4).map((meeting) => (
                      <i
                        key={`${meeting.group_id}-${meeting.id}`}
                        style={{
                          background: colorOf(meeting.group_id),
                        }}
                      />
                    ))}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* selectionOnly: 날짜를 누르기 전에는 상세 패널을 숨긴다. */}
        {(!selectionOnly || selected) && (
        <div className={css.panel}>
          {selected ? (
            <>
              <div className={css.panelHead}>
                <span className={css.panelTitle}>{dayLabel(selected)}</span>

                <button
                  type="button"
                  className="btn secondary sm"
                  onClick={() => setSelected(null)}
                >
                  {dashboard || selectionOnly ? '선택 해제' : '다가오는 약속 보기'}
                </button>
              </div>

              {loading ? (
                <span className="muted">불러오는 중…</span>
              ) : selectedMeetings.length === 0 ? (
                <span className="muted">이 날은 약속이 없어요.</span>
              ) : (
                selectedMeetings.map((meeting) => renderMeeting(meeting, false))
              )}
            </>
          ) : (
            <>
              <span className={css.panelTitle}>다가오는 약속</span>

              {loading ? (
                <span className="muted">불러오는 중…</span>
              ) : upcoming.length === 0 ? (
                <span className="muted">앞으로 예정된 약속이 없어요.</span>
              ) : (
                upcoming.map((meeting) => renderMeeting(meeting, true))
              )}
            </>
          )}
        </div>
        )}
      </div>
    </div>
  )
}
