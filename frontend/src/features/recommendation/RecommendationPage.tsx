'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

import BaseKakaoMap, { type MapPlace } from '../map/BaseKakaoMap'
import styles from '../map/map.module.css'
import layout from './recommendation.module.css'
import { usePlacePlan } from './usePlacePlan'

// BaseKakaoMap의 번호별 파스텔 색상과 같은 팔레트.
const MEMBER_COLORS = ['#A8DCD1', '#AFCBF3', '#F6D6A8', '#D5C2F1', '#F3BFD0']

// 상태 조회 응답이 같으면 지도는 다시 그리지 않아 사용자의 확대/이동을 유지한다.
const StableKakaoMap = memo(BaseKakaoMap, (previous, next) =>
  previous.selectedPlaceId === next.selectedPlaceId &&
  previous.height === next.height &&
  previous.onPlaceClick === next.onPlaceClick &&
  JSON.stringify(previous.places) === JSON.stringify(next.places),
)

interface SearchPlace {
  id: string
  place_name: string
  road_address_name: string
  address_name: string
  x: string
  y: string
}

export default function RecommendationPage() {
  const params = useSearchParams()
  const groupId = params.get('groupId') ?? ''
  const planId = params.get('planId') ?? ''
  if (
    !/^[1-9]\d*$/.test(groupId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      planId,
    )
  ) {
    return (
      <section className={styles.page}>
        <h1>약속 장소 추천</h1>
        <p>
          그룹 채팅에서 ‘장소 선택’을 눌러 새 추천을 시작하거나, 채팅에 공유된
          추천 링크를 열어 주세요.
        </p>
        <Link href="/groups">내 그룹으로 돌아가기</Link>
      </section>
    )
  }
  return (
    <DepartureEditor
      key={`${groupId}-${planId}`}
      groupId={groupId}
      planId={planId}
    />
  )
}

function DepartureEditor({
  groupId,
  planId,
}: {
  groupId: string
  planId: string
}) {
  const {
    plan,
    error,
    saving,
    recommending,
    connected,
    saveDeparture: persistDeparture,
    recommend,
  } = usePlacePlan(groupId, planId)
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<SearchPlace[]>([])
  const [selectedId, setSelectedId] = useState('')
  const handlePlaceClick = useCallback((place: MapPlace) => setSelectedId(place.id), [])
  const [searching, setSearching] = useState(false)
  const [mapView, setMapView] = useState(0)
  const [message, setMessage] = useState('')
  const searchVersion = useRef(0)
  const me = plan?.me
  const group = {
    id: Number(groupId),
    name: plan?.group_name ?? '',
    members: plan?.members ?? [],
  }
  const departure = plan?.own_departure ?? null

  useEffect(
    () => () => {
      searchVersion.current += 1
    },
    [],
  )

  const searchPlaces = () => {
    const query = keyword.trim()
    if (!query || searching) {
      if (!query) setMessage('출발지를 입력해 주세요.')
      return
    }

    const kakao = window.kakao
    if (!kakao?.maps?.services?.Places) {
      setMessage('지도를 준비하고 있어요. 잠시 후 다시 검색해 주세요.')
      return
    }

    const version = ++searchVersion.current
    setSearching(true)
    setMessage('')
    setSelectedId('')

    const service = new kakao.maps.services.Places()
    service.keywordSearch(query, (data: SearchPlace[], status: string) => {
      if (version !== searchVersion.current) return
      setSearching(false)
      if (status === kakao.maps.services.Status.OK) {
        setResults(data)
      } else {
        setResults([])
        setMessage(
          status === kakao.maps.services.Status.ZERO_RESULT
            ? '검색 결과가 없어요. 다른 검색어를 입력해 주세요.'
            : '검색에 실패했어요. 다시 시도해 주세요.',
        )
      }
    })
  }

  const saveDeparture = async (place: SearchPlace) => {
    const latitude = Number(place.y)
    const longitude = Number(place.x)
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      setMessage('장소 좌표가 올바르지 않습니다.')
      return
    }

    searchVersion.current += 1
    setSearching(false)
    const saved = await persistDeparture({
      place_id: place.id,
      name: place.place_name,
      address: place.road_address_name || place.address_name || '',
      latitude,
      longitude,
    })
    if (!saved) return
    setResults([])
    setKeyword('')
    setSelectedId('')
    setMessage('내 출발지를 저장했어요. 같은 그룹 멤버의 카드와 지도에도 표시돼요.')
  }

  const removeDeparture = async () => {
    searchVersion.current += 1
    setSearching(false)
    if (!(await persistDeparture(null))) return
    setResults([])
    setSelectedId('')
    setMessage('')
  }

  const recommendations = connected && !saving ? (plan?.result?.recommendations ?? []) : []
  const memberPlaces: MapPlace[] = group.members.flatMap((member, index) => {
    const saved = member.departure ?? (member.user_id === me?.id ? departure : null)
    return saved ? [{
      id: `departure-${member.user_id}`,
      name: `${member.nickname}: ${saved.name}`,
      latitude: saved.latitude,
      longitude: saved.longitude,
      memberNumber: index + 1,
    }] : []
  })
  const mapPlaces: MapPlace[] = [
    ...memberPlaces,
    ...recommendations.map((place, index) => ({ ...place, id: `recommend-${place.id}`, name: `${index + 1}위 · ${place.name}` })),
    ...results.map((place) => ({ id: `search-${place.id}`, name: place.place_name,
      latitude: Number(place.y), longitude: Number(place.x) })),
  ]
  const readyCount = group.members.filter(member => member.ready).length
  const showAllDepartures = () => {
    searchVersion.current += 1
    setSearching(false)
    setResults([])
    setSelectedId('')
    setMapView(value => value + 1)
  }

  if (!plan || !me)
    return (
      <section className={styles.page}>
        <h1>약속 장소 추천</h1>
        <p role={error ? 'alert' : 'status'}>
          {error || '그룹과 출발지 정보를 불러오고 있어요.'}
        </p>
        {error && (
          <p>
            <Link href="/login">로그인하기</Link> ·{' '}
            <Link href="/groups">내 그룹</Link>
          </p>
        )}
      </section>
    )


  return (
    <div className={`${styles.page} ${layout.page}`}>
      <header style={{ marginBottom: 24 }}>
        <Link href={`/groups/${group.id}/chat`}>← 그룹 채팅으로 돌아가기</Link>
        <p className={styles.hint}>
          {group.name} · {me.nickname}님으로 로그인 중
        </p>
        <h1 style={{ margin: '8px 0', fontSize: 28 }}>우리 어디서 만날까요?</h1>
        <p className={styles.hint}>
          각자의 출발지를 입력하고 함께 만나기 좋은 장소를 찾아요.
        </p>
      </header>

      <div className={layout.panel}>
      {error && (
        <p className={styles.message} role="alert">
          {error}
        </p>
      )}
      <p className={styles.hint}>
        {connected
          ? '3초마다 멤버 출발지와 추천 결과를 확인해요.'
          : '연결 확인 중 · 마지막으로 확인한 상태입니다.'}
      </p>
      <section className={styles.membersSection}>
        <div className={styles.heading}>
          <h2>멤버별 출발지</h2>
          <span className={styles.badge}>
            {readyCount}/{group.members.length}명 완료
          </span>
        </div>
        <div className={styles.memberGrid}>
          {group.members.map((member, index) => {
            const isMe = member.user_id === me.id
            const saved = member.departure ?? (isMe ? departure : null)
            const color = MEMBER_COLORS[index % MEMBER_COLORS.length]
            return (
              <div key={member.user_id}
                className={`${styles.memberCard} ${layout.memberCard} ${isMe ? styles.memberActive : ''}`}
                style={{ borderTop: `4px solid ${color}` }}>
                <div className={layout.memberTitle}>
                  <span className={layout.memberNumber} style={{ backgroundColor: color }}
                    aria-label={`${index + 1}번 멤버`}>{index + 1}</span>
                  <p className={styles.memberName}>{member.nickname}{isMe ? ' (나)' : ''}</p>
                </div>
                <p className={styles.memberDeparture}>
                  {saved?.name ?? (member.ready ? '출발지 정보를 불러오는 중' : '출발지 입력 대기 중')}
                </p>
                <div className={layout.memberActions}>
                  {saved && <button type="button" className={styles.memberButton}
                    onClick={() => setSelectedId(`departure-${member.user_id}`)}>지도에서 보기</button>}
                  {isMe && saved && <button type="button" className={styles.removeButton}
                    disabled={saving} onClick={() => void removeDeparture()}>출발지 삭제</button>}
                </div>
              </div>
            )
          })}
        </div>
        <p className={styles.hint}>
          입력한 출발지는 같은 그룹 멤버의 카드와 지도에 공유돼요.
          카드의 색상·번호가 지도 마커와 같으며, 수정·삭제는 본인만 할 수 있어요.
        </p>
      </section>

      <div className={`${styles.layout} ${layout.contentLayout}`}>
        <section className={styles.search}>
          <div>
            <h3>{me.nickname}님의 출발지 입력</h3>
            <p className={styles.hint}>출발할 역이나 장소를 검색해 주세요.</p>
          </div>
          <form
            className={styles.searchRow}
            onSubmit={(event) => {
              event.preventDefault()
              searchPlaces()
            }}
          >
            <input
              className={styles.input}
              aria-label="내 출발지 검색"
              placeholder="예: 홍대입구역"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.nativeEvent.isComposing)
                  event.preventDefault()
              }}
            />
            <button
              type="submit"
              className={styles.button}
              disabled={searching || saving}
            >
              {searching ? '검색 중' : '검색'}
            </button>
          </form>
          {message && (
            <p className={styles.message} role="status">
              {message}
            </p>
          )}
          <section className={styles.results}>
            <div className={styles.heading}>
              <h3>검색 결과</h3>
              <span className={styles.hint}>{results.length}개</span>
            </div>
            {results.length === 0 && (
              <p className={styles.empty}>검색한 장소가 여기에 표시돼요.</p>
            )}
            <div className={styles.resultList}>
              {results.map((place) => (
                <div
                  key={place.id}
                  className={`${styles.resultCard} ${selectedId === `search-${place.id}` ? styles.resultSelected : ''}`}
                >
                  <button
                    type="button"
                    className={styles.placeButton}
                    onClick={() => setSelectedId(`search-${place.id}`)}
                  >
                    <p className={styles.placeName}>{place.place_name}</p>
                    <p className={styles.hint}>
                      {place.road_address_name || place.address_name}
                    </p>
                  </button>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.saveButton}`}
                    disabled={saving}
                    onClick={() => void saveDeparture(place)}
                  >
                    {saving ? '저장 중' : '내 출발지로 지정'}
                  </button>
                </div>
              ))}
            </div>
          </section>
        </section>
        <section className={styles.mapSection}>
          <div className={`${styles.mapHeader} ${layout.mapHeading}`}>
            <div><h3>멤버 출발지 지도</h3>
              <p className={styles.hint}>색상과 번호로 각 멤버의 출발지를 확인하세요.</p></div>
            <button type="button" className={layout.viewAll} disabled={memberPlaces.length === 0}
              onClick={showAllDepartures}>전체 출발지 보기</button>
          </div>
          <StableKakaoMap
            key={mapView}
            places={mapPlaces}
            selectedPlaceId={selectedId}
            onPlaceClick={handlePlaceClick}
            height="600px"
          />
          <p className={styles.hint}>멤버 출발지 {memberPlaces.length}곳이 지도에 표시돼요.</p>
        </section>
      </div>

      <section className={styles.membersSection} style={{ marginTop: 24 }}>
        <div className={styles.heading}>
          <h2>추천 장소</h2>
          <span className={styles.badge}>
            {group.members.filter((m) => m.ready).length}/{group.members.length}
            명 입력 완료
          </span>
        </div>
        <p className={styles.hint}>
          그룹 멤버 전원(2~5명)의 출발지가 모이면 실제 대중교통 이동시간으로
          추천해요. 출발지를 변경하거나 삭제하면 기존 추천은 초기화돼요.
        </p>
        <button
          type="button"
          className={styles.button}
          style={{ marginTop: 16 }}
          disabled={!connected || !plan.can_recommend || saving || recommending}
          onClick={() => void recommend()}
        >
          {recommending
            ? '이동시간 비교 중…'
            : plan.result
              ? '약속 장소 다시 추천받기'
              : '약속 장소 추천받기'}
        </button>
        {recommending && (
          <p role="status">
            멤버별 이동시간을 조회하고 있어요. 잠시 기다려 주세요.
          </p>
        )}
        {plan.result && recommendations.length > 0 && (
          <p className={styles.hint}>
            {plan.result.ranking_rule} · 조회 실패로 제외된 후보{' '}
            {plan.result.excluded_count}곳<br />
            {new Date(plan.result.generated_at).toLocaleString('ko-KR')} 조회
            기준 예상 시간입니다. 같은 입력의 결과는 5분 동안 재사용해요.
          </p>
        )}
        <div className={styles.memberGrid} style={{ marginTop: 16 }}>
          {recommendations.map((place, index) => (
            <article key={place.id} className={styles.memberCard}>
              <h3>
                {index + 1}위 · {place.name}
              </h3>
              <p className={styles.hint}>{place.address}</p>
              <p>
                평균 {place.average}분 · 가장 오래 걸리는 멤버 {place.maximum}분
              </p>
              <ul>
                {plan.result?.member_ids.map((id, i) => (
                  <li key={id}>
                    {group.members.find((m) => m.user_id === id)?.nickname ??
                      '멤버'}
                    : {place.member_minutes[i]}분
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={styles.memberButton}
                onClick={() => setSelectedId(`recommend-${place.id}`)}
              >
                지도에서 보기
              </button>
            </article>
          ))}
        </div>
        <p className={styles.hint}>
          추천 결과까지 공유됩니다. 최종 장소 투표와 약속 확정은 별도 기능에서
          연결할 예정이에요.
        </p>
      </section>
      </div>
    </div>
  )
}
