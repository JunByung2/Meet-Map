'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { type MeetingRecord, formatMeetDate } from '@/lib/records'
import { type Photo, formatDate } from '@/lib/photos'
import Avatar from '@/components/Avatar'
import css from './group-home.module.css'

type Meeting = {
  id: number
  title: string
  location: string
  meeting_time: string
  status: string
}
type Load<T> = { data: T[] | null; error: boolean }

function Picture({
  src,
  label,
  eager = false,
}: {
  src: string | null
  label: string
  eager?: boolean
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return src && !failed ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={label}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  ) : (
    <div className={css.placeholder}>함께한 순간을 사진으로 남겨 보세요</div>
  )
}
function getDday(meetingTime: string, now: number) {
  const koreanDay = (time: number) =>
    Math.floor((time + 9 * 60 * 60 * 1000) / 86400000)

  const days = koreanDay(new Date(meetingTime).getTime()) - koreanDay(now)

  return days === 0 ? 'D-day' : `D-${days}`
}

export default function GroupHomeOverview({
  groupId,
  groupName,
  members,
}: {
  groupId: number
  groupName: string
  members: { user_id: number; nickname: string; profile_image: string | null }[]
}) {
  const [records, setRecords] = useState<Load<MeetingRecord>>({
    data: null,
    error: false,
  })
  const [photos, setPhotos] = useState<Load<Photo>>({
    data: null,
    error: false,
  })
  const [meetings, setMeetings] = useState<Load<Meeting>>({
    data: null,
    error: false,
  })
  const [nickname, setNickname] = useState('')
  const [retry, setRetry] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const base = `/groups/${groupId}`
  useEffect(() => {
    let active = true
    api<{ nickname: string }>('/auth/me')
      .then((me) => {
        if (active) setNickname(me.nickname)
      })
      .catch(() => {})
    const timer = setInterval(() => setNow(Date.now()), 60000)
    function load<T>(path: string, update: (value: Load<T>) => void) {
      api<T[]>(path)
        .then((data) => {
          if (active) update({ data, error: false })
        })
        .catch(() => {
          if (active) update({ data: null, error: true })
        })
    }
    load<MeetingRecord>(`${base}/records`, setRecords)
    load<Photo>(`${base}/photos`, setPhotos)
    load<Meeting>(`${base}/meetings`, setMeetings)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [base, retry])
  const recent = [...(records.data ?? [])].sort(
    (a, b) => b.meet_date.localeCompare(a.meet_date) || b.id - a.id,
  )
  const latest = recent[0]
  const upcoming = [...(meetings.data ?? [])]
    .filter(
      (m) =>
        m.status === 'confirmed' && new Date(m.meeting_time).getTime() >= now,
    )
    .sort(
      (a, b) =>
        new Date(a.meeting_time).getTime() - new Date(b.meeting_time).getTime(),
    )[0]
  const finished = meetings.data?.filter(
    (m) => m.status === 'confirmed' && new Date(m.meeting_time).getTime() < now,
  ).length
  const recentPhotos = [...(photos.data ?? [])]
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .slice(0, 3)
  const notice = (value: Load<unknown>, empty: string) =>
    value.error
      ? '불러오지 못했어요. 다시 시도해 주세요.'
      : value.data === null
        ? '불러오는 중…'
        : empty
  const friends = (
    <div className={css.friends}>
      {members.slice(0, 5).map((m, i) => (
        <Avatar
          key={m.user_id}
          userId={m.user_id}
          name={m.nickname}
          image={m.profile_image}
          tone={['', 'peach', 'lavender'][i % 3]}
        />
      ))}
      <span>우리 그룹, {members.length}명</span>
    </div>
  )
  return (
    <div className={css.home}>
      <header className={css.header}>
        <div>
          <p className={css.eyebrow}>우리의 작은 아카이브 · {groupName}</p>
          <h1>{nickname ? `${nickname}님, ` : ''}오늘도 반가워요.</h1>
          <p className={css.muted}>
            함께한 시간은 지나가도, 우리의 이야기는 여기 남아요.
          </p>
        </div>
        <Link className="btn secondary" href="/groups">
          내 그룹
        </Link>
      </header>
      <div className={css.stats}>
        <div>
          <span>함께한 약속</span>
          <strong>{finished == null ? '—' : `${finished}번`}</strong>
        </div>
        <div>
          <span>쌓인 추억</span>
          <strong>{records.data ? `${records.data.length}개` : '—'}</strong>
        </div>
        <div>
          <span>최근 조회한 사진</span>
          <strong>{photos.data ? `${photos.data.length}장` : '—'}</strong>
        </div>
      </div>
      {(records.error || photos.error || meetings.error) && (
        <p role="alert" className={css.muted}>
          일부 정보를 불러오지 못했어요.{' '}
          <button
            className="btn secondary sm"
            onClick={() => setRetry((n) => n + 1)}
          >
            다시 불러오기
          </button>
        </p>
      )}
      <div className={css.main}>
        <section>
          <div className={css.heading}>
            <h2>우리의 가장 최근 추억</h2>
            <Link href={`${base}/records`}>기록 모두 보기 →</Link>
          </div>
          <article className={css.hero}>
            <div className={css.cover}>
              <Picture
                src={latest?.cover_url ?? null}
                label={latest?.title ?? '최근 추억'}
                eager
              />
            </div>
            {latest ? (
              <div className={css.heroBody}>
                <div>
                  <h3>{latest.title}</h3>
                  <p className={css.muted}>
                    {formatMeetDate(latest.meet_date)} ·{' '}
                    {latest.place_name || '장소 미등록'} · 사진{' '}
                    {latest.photo_count}장
                  </p>
                  {friends}
                </div>
                <Link
                  className="btn secondary sm"
                  href={`${base}/records/${latest.id}`}
                >
                  추억 열어보기
                </Link>
              </div>
            ) : (
              <p className={css.empty}>
                {notice(
                  records,
                  '아직 쌓인 추억이 없어요. 첫 약속을 만들어 보세요.',
                )}
              </p>
            )}
          </article>
        </section>
        <aside>
          <div className={css.heading}>
            <h2>다음에 만나는 날</h2>
          </div>
          <div className={css.next}>
            <span className={css.badge}>
              다가오는 약속
              {upcoming && ` · ${getDday(upcoming.meeting_time, now)}`}
            </span>
            {upcoming ? (
              <>
                <h3>{upcoming.title}</h3>
                <p className={css.muted}>
                  {new Date(upcoming.meeting_time).toLocaleString('ko-KR', {
                    timeZone: 'Asia/Seoul',
                    month: 'long',
                    day: 'numeric',
                    weekday: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
                <p>⌖ {upcoming.location}</p>
                <Link className="btn secondary sm" href={`${base}/meetings`}>
                  약속 보기
                </Link>
              </>
            ) : (
              <p className={css.empty}>
                {notice(meetings, '예정된 약속이 없어요.')}
              </p>
            )}
            <Link className={css.meetLink} href={`${base}/chat`}>
              친구들과 채팅 · MeetMode →
            </Link>
          </div>
          <div className={css.chat}>
            <strong>다음 이야기를 이어가요</strong>
            <p>만날 장소와 시간을 친구들과 함께 정해 보세요.</p>
            <Link href={`${base}/chat`}>채팅으로 가기 →</Link>
          </div>
        </aside>
      </div>
      <section>
        <div className={css.heading}>
          <h2>최근 모아 둔 사진</h2>
          <Link href={`${base}/photos`}>사진 전체 보기 →</Link>
        </div>
        <div className={css.gallery}>
          {recentPhotos.map((photo) => (
            <Link
              key={photo.id}
              className={css.photo}
              href={`${base}/photos/${photo.id}`}
            >
              <div className={css.thumbnail}>
                <Picture
                  src={photo.signed_url || photo.url}
                  label={photo.title || photo.caption || '그룹 사진'}
                />
              </div>
              <p className={css.meta}>
                {formatDate(photo.created_at)} ·{' '}
                {photo.place_name || '장소 미등록'}
              </p>
              <strong>{photo.title || photo.caption || '함께한 순간'}</strong>
            </Link>
          ))}
        </div>
        {!recentPhotos.length && (
          <p className={css.empty}>
            {notice(photos, '아직 사진이 없어요. 첫 사진을 남겨 보세요.')}
          </p>
        )}
      </section>
      <section>
        <div className={css.heading}>
          <h2>다시 꺼내 보고 싶은 순간</h2>
          <Link href={`/map?groupId=${groupId}&view=memory`}>
            추억지도 보기 →
          </Link>
        </div>
        <div className={css.gallery}>
          {recent.slice(1, 4).map((record) => (
            <Link
              className={css.memory}
              key={record.id}
              href={`${base}/records/${record.id}`}
            >
              <div className={css.thumbnail}>
                <Picture src={record.cover_url} label={record.title} />
              </div>
              <div className={css.memoryBody}>
                <p className={css.meta}>
                  {formatMeetDate(record.meet_date)} · 사진 {record.photo_count}
                  장
                </p>
                <h3>{record.title}</h3>
                <p className={css.muted}>
                  ⌖ {record.place_name || '장소 미등록'}
                </p>
              </div>
            </Link>
          ))}
        </div>
        {recent.length <= 1 && (
          <p className={css.empty}>
            {notice(records, '앞으로 함께할 순간들이 이곳에 쌓여요.')}
          </p>
        )}
      </section>
      <footer className={css.footer}>
        <div>
          <strong>지난 기록도 모두 남아 있어요</strong>
          <p className={css.muted}>함께한 모든 순간을 다시 꺼내 보세요.</p>
        </div>
        <Link className="btn secondary sm" href={`${base}/records`}>
          지난 기록 보기 →
        </Link>
      </footer>
    </div>
  )
}
