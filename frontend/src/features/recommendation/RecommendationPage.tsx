'use client'

import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import BaseKakaoMap, { type MapPlace } from '../map/BaseKakaoMap'
import styles from '../map/map.module.css'

interface Me {
  id: number
  nickname: string
}

interface Group {
  id: number
  name: string
  members: { user_id: number; nickname: string; role: string }[]
}

interface SearchPlace {
  id: string
  place_name: string
  road_address_name: string
  address_name: string
  x: string
  y: string
}

// 진입할 때마다 기존 API로 로그인과 그룹 접근 권한을 확인한다.
export default function RecommendationPage() {
  const [context, setContext] = useState<{ me: Me; group: Group } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [needLogin, setNeedLogin] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const groupId = new URLSearchParams(window.location.search).get('groupId')

      if (!groupId || !/^[1-9]\d*$/.test(groupId)) {
        setError('그룹 정보가 없어요. 그룹 ID가 포함된 추천 링크로 열어 주세요.')
        setLoading(false)
        return
      }

      try {
        const [me, group] = await Promise.all([
          api<Me>('/auth/me'),
          api<Group>(`/groups/${groupId}`),
        ])

        if (cancelled) return

        if (!group.members.some((member) => member.user_id === me.id)) {
          setError('이 그룹의 멤버만 사용할 수 있어요.')
          return
        }

        setContext({ me, group })
      } catch (err) {
        if (cancelled) return

        if (err instanceof ApiError && err.status === 401) {
          setNeedLogin(true)
          setError('로그인한 뒤 원래 추천 링크를 다시 열어 주세요.')
        } else if (err instanceof ApiError && err.status === 403) {
          setError('이 그룹에 접근할 권한이 없어요.')
        } else {
          setError('그룹 정보를 불러오지 못했어요. 기존 백엔드 연결을 확인해 주세요.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [])

  if (loading) return <p role="status">로그인과 그룹 정보를 확인하고 있어요.</p>

  if (error) {
    return (
      <section className={styles.page}>
        <h1>약속 장소 추천</h1>
        <p className={styles.message} role="alert">{error}</p>
        {needLogin && <p><a href="/login">로그인하러 가기</a></p>}
        <p><a href="/groups">내 그룹으로 돌아가기</a></p>
      </section>
    )
  }

  if (!context) return null

  return (
    <DepartureEditor
      key={`${context.group.id}-${context.me.id}`}
      me={context.me}
      group={context.group}
    />
  )
}

function DepartureEditor({ me, group }: { me: Me; group: Group }) {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<SearchPlace[]>([])
  const [departure, setDeparture] = useState<MapPlace | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [searching, setSearching] = useState(false)
  const [message, setMessage] = useState('')
  const searchVersion = useRef(0)
  const myIndex = group.members.findIndex((member) => member.user_id === me.id)
  const myMarkerId = `departure-${me.id}`

  useEffect(() => () => { searchVersion.current += 1 }, [])

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
        setMessage(status === kakao.maps.services.Status.ZERO_RESULT
          ? '검색 결과가 없어요. 다른 검색어를 입력해 주세요.'
          : '검색에 실패했어요. 다시 시도해 주세요.')
      }
    })
  }

  const saveDeparture = (place: SearchPlace) => {
    const latitude = Number(place.y)
    const longitude = Number(place.x)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      setMessage('장소 좌표가 올바르지 않습니다.')
      return
    }

    searchVersion.current += 1
    setSearching(false)
    setDeparture({ id: place.id, name: place.place_name, latitude, longitude })
    setResults([])
    setKeyword('')
    setSelectedId(myMarkerId)
    setMessage('내 출발지를 지정했어요. 아직 DB에 저장되지 않으며 새로고침하면 사라져요.')
  }

  const removeDeparture = () => {
    searchVersion.current += 1
    setSearching(false)
    setDeparture(null)
    setResults([])
    setSelectedId('')
    setMessage('')
  }

  const mapPlaces: MapPlace[] = [
    ...results.map((place) => ({
      id: `search-${place.id}`,
      name: place.place_name,
      latitude: Number(place.y),
      longitude: Number(place.x),
    })),
    ...(departure ? [{
      ...departure,
      id: myMarkerId,
      name: `${me.nickname}: ${departure.name}`,
      memberNumber: myIndex + 1,
    }] : []),
  ]

  return (
    <div className={styles.page}>
      <header style={{ marginBottom: 24 }}>
        <a href={`/groups/${group.id}`}>← 그룹으로 돌아가기</a>
        <p className={styles.hint}>{group.name} · {me.nickname}님으로 로그인 중</p>
        <h1 style={{ margin: '8px 0', fontSize: 28 }}>약속 장소 추천</h1>
        <p className={styles.hint}>각자의 출발지를 입력하고 함께 만나기 좋은 장소를 찾아요.</p>
      </header>

      <section className={styles.membersSection}>
        <div className={styles.heading}>
          <h2>그룹 멤버 출발지</h2>
          <span className={styles.badge}>그룹 멤버 {group.members.length}명</span>
        </div>
        <div className={styles.memberGrid}>
          {group.members.map((member) => {
            const isMe = member.user_id === me.id
            return (
              <div key={member.user_id} className={`${styles.memberCard} ${isMe ? styles.memberActive : ''}`}>
                <p className={styles.memberName}>{member.nickname}{isMe ? ' (나)' : ''}</p>
                <p className={styles.memberDeparture}>
                  {isMe ? (departure?.name ?? '내 출발지 미지정') : '출발지 공유 연결 전'}
                </p>
                {isMe && departure && (
                  <>
                    <button type="button" className={styles.memberButton}
                      onClick={() => setSelectedId(myMarkerId)}>지도에서 보기</button>
                    <button type="button" className={styles.removeButton}
                      style={{ marginTop: 12 }} onClick={removeDeparture}>출발지 삭제</button>
                  </>
                )}
              </div>
            )
          })}
        </div>
        <p className={styles.hint}>
          실제 그룹 멤버 목록입니다. 다른 멤버의 출발지 입력 여부는 아직 조회하지 않습니다.
        </p>
      </section>

      <div className={styles.layout}>
        <section className={styles.search}>
          <div><h3>{me.nickname}님의 출발지 입력</h3>
            <p className={styles.hint}>출발할 역이나 장소를 검색해 주세요.</p></div>
          <form className={styles.searchRow} onSubmit={(event) => {
            event.preventDefault()
            searchPlaces()
          }}>
            <input className={styles.input} aria-label="내 출발지 검색" placeholder="예: 홍대입구역"
              value={keyword} onChange={(event) => setKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
              }} />
            <button type="submit" className={styles.button} disabled={searching}>
              {searching ? '검색 중' : '검색'}
            </button>
          </form>
          {message && <p className={styles.message} role="status">{message}</p>}
          <section className={styles.results}>
            <div className={styles.heading}><h3>검색 결과</h3>
              <span className={styles.hint}>{results.length}개</span></div>
            {results.length === 0 && <p className={styles.empty}>검색한 장소가 여기에 표시돼요.</p>}
            <div className={styles.resultList}>
              {results.map((place) => (
                <div key={place.id} className={`${styles.resultCard} ${selectedId === `search-${place.id}` ? styles.resultSelected : ''}`}>
                  <button type="button" className={styles.placeButton}
                    onClick={() => setSelectedId(`search-${place.id}`)}>
                    <p className={styles.placeName}>{place.place_name}</p>
                    <p className={styles.hint}>{place.road_address_name || place.address_name}</p>
                  </button>
                  <button type="button" className={`${styles.button} ${styles.saveButton}`}
                    onClick={() => saveDeparture(place)}>내 출발지로 지정</button>
                </div>
              ))}
            </div>
          </section>
        </section>
        <section className={styles.mapSection}>
          <div className={styles.mapHeader}><h3>내 출발지 지도</h3>
            <p className={styles.hint}>검색 결과와 내 출발지를 확인하세요.</p></div>
          <BaseKakaoMap places={mapPlaces} selectedPlaceId={selectedId}
            onPlaceClick={(place) => setSelectedId(place.id)} height="540px" />
        </section>
      </div>

      <section className={styles.membersSection} style={{ marginTop: 24 }}>
        <div className={styles.heading}><h2>추천 장소</h2>
          <span className={styles.badge}>공유 저장 연결 대기</span></div>
        <p className={styles.hint}>
          내 출발지 입력은 {departure ? '완료했어요.' : '아직 하지 않았어요.'}
          {' '}출발지 저장·조회 API를 연결한 뒤 그룹 전원의 입력으로 실제 추천을 실행합니다.
        </p>
        <button type="button" className={styles.button} style={{ marginTop: 16 }} disabled>
          약속 장소 추천받기
        </button>
      </section>
    </div>
  )
}
