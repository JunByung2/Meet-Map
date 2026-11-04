'use client'

// ======================================================
// MeetMap - KakaoMap.tsx
//
// [2주차]
// - 카카오 장소 검색
// - 검색 결과 목록 출력
// - 지도에 검색 결과 마커 표시
// - 장소 선택 시 지도 이동 및 마커 강조
//
// [3주차]
// - 멤버 5명 관리
// - 멤버별 출발지 검색 및 선택
// - 멤버별 출발지 저장 및 삭제
// - 저장된 출발지를 지도에 마커로 표시
// ======================================================
import styles from './map.module.css'
// [기존 - 2주차]
// React에서 사용할 기능 불러오기
import { useEffect, useRef, useState } from 'react'

// [기존 - 2주차]
// 공통 지도 컴포넌트 불러오기
import BaseKakaoMap, { type MapPlace } from './BaseKakaoMap'

// ======================================================
// 1. 장소 데이터 구조
// [기존 - 2주차]
// ======================================================

// 카카오 장소 검색 API에서 반환하는 데이터 형식
interface Place {
  id: string // 장소 고유 ID
  place_name: string // 장소 이름
  address_name: string // 지번 주소
  road_address_name: string // 도로명 주소
  x: string // 경도
  y: string // 위도
}

// ======================================================
// 2. 멤버 데이터 구조
// [추가 - 3주차]
// ======================================================

// 기존에는 장소 정보만 관리했지만,
// 3주차부터는 각 멤버의 출발지도 저장해야 하므로 추가함.
interface Member {
  id: number // 멤버 번호 (1~5)
  name: string // 멤버 이름
  departure: MapPlace | null // 선택한 출발지
}

// departure가 null이면 아직 출발지를 지정하지 않은 상태

// ======================================================
// 3. KakaoMap 컴포넌트
// ======================================================

export default function KakaoMap() {
  // ----------------------------------------------------
  // 3-1. 장소 검색 관련 상태
  // [기존 - 2주차]
  // ----------------------------------------------------

  // 검색창에 입력한 키워드
  const [keyword, setKeyword] = useState('')

  // 카카오 장소 검색 결과 목록
  const [places, setPlaces] = useState<Place[]>([])

  // 현재 선택한 장소의 ID
  const [selectedId, setSelectedId] = useState('')

  // API 검색 중인지 확인
  const [loading, setLoading] = useState(false)

  // 카카오 장소 검색 서비스를 사용할 준비가 되었는지 확인
  const [searchReady, setSearchReady] = useState(false)

  // 오류 및 안내 메시지
  const [message, setMessage] = useState('')

  // 카카오 장소 검색 서비스 객체 저장
  const placesService = useRef<any>(null)

  // ----------------------------------------------------
  // 3-2. 멤버 5명 관리
  // [추가 - 3주차]
  // ----------------------------------------------------

  // 멤버 5명의 출발지 정보를 저장하는 상태
  const [members, setMembers] = useState<Member[]>([
    {
      id: 1,
      name: '멤버 1',
      departure: null,
    },
    {
      id: 2,
      name: '멤버 2',
      departure: null,
    },
    {
      id: 3,
      name: '멤버 3',
      departure: null,
    },
    {
      id: 4,
      name: '멤버 4',
      departure: null,
    },
    {
      id: 5,
      name: '멤버 5',
      departure: null,
    },
  ])

  // 현재 출발지를 지정할 멤버 번호
  // 처음에는 멤버 1이 선택되어 있음.
  const [selectedMemberId, setSelectedMemberId] = useState<number>(1)

  // ====================================================
  // 4. 카카오 장소 검색 서비스 초기화
  // [기존 - 2주차]
  // ====================================================

  useEffect(() => {
    // .env.local 파일에 저장된 JavaScript API 키 가져오기
    const appKey = process.env.NEXT_PUBLIC_KAKAO_JS_KEY

    // API 키가 없다면 오류 메시지 출력
    if (!appKey) {
      setMessage('카카오 JavaScript 키가 설정되지 않았습니다.')
      return
    }

    // 컴포넌트가 사라진 후 실행되지 않도록 확인하는 변수
    let cancelled = false

    // 카카오 장소 검색 서비스 생성 함수
    const initializeSearch = () => {
      // 카카오 지도 SDK가 아직 없다면 종료
      if (!window.kakao?.maps) return

      // 카카오 지도 SDK가 준비되면 실행
      window.kakao.maps.load(() => {
        if (cancelled) return

        // 카카오 장소 검색 객체 생성
        placesService.current = new window.kakao.maps.services.Places()

        // 검색 기능 사용 가능 상태로 변경
        setSearchReady(true)
      })
    }

    // 이미 SDK가 로드된 경우 바로 초기화
    if (window.kakao?.maps) {
      initializeSearch()

      return () => {
        cancelled = true
      }
    }

    // 카카오 SDK 스크립트 ID
    const scriptId = 'kakao-map-sdk'

    // 이미 추가된 스크립트가 있는지 확인
    let script = document.getElementById(scriptId) as HTMLScriptElement | null

    // 스크립트가 없다면 새로 생성
    if (!script) {
      script = document.createElement('script')
      script.id = scriptId

      // 카카오 지도 JavaScript SDK 주소
      script.src =
        'https://dapi.kakao.com/v2/maps/sdk.js' +
        `?appkey=${appKey}&autoload=false&libraries=services`

      script.async = true

      // HTML 문서에 SDK 스크립트 추가
      document.head.appendChild(script)
    }

    // 스크립트 로딩이 완료되면 검색 서비스 초기화
    script.addEventListener('load', initializeSearch)

    // 스크립트 로딩 실패 시 실행
    const handleError = () => {
      if (!cancelled) {
        setMessage('카카오 장소 검색 서비스를 불러오지 못했습니다.')
      }
    }

    script.addEventListener('error', handleError)

    // 컴포넌트가 종료되면 이벤트 정리
    return () => {
      cancelled = true

      script?.removeEventListener('load', initializeSearch)

      script?.removeEventListener('error', handleError)
    }
  }, [])

  // ====================================================
  // 5. 카카오 장소 데이터를 지도 데이터로 변환
  // [수정 - 3주차]
  // ====================================================

  // [2주차]
  // 기존에는 검색 결과 배열 전체를 변환했음.
  //
  // [3주차]
  // 이제는 장소 하나를 변환하는 함수로 변경함.
  // 멤버 출발지 저장과 검색 결과 표시에서 모두 재사용 가능.

  const convertPlace = (place: Place): MapPlace => ({
    id: place.id,
    name: place.place_name,

    // 카카오 API의 y는 위도
    latitude: Number(place.y),

    // 카카오 API의 x는 경도
    longitude: Number(place.x),
  })

  // ====================================================
  // 6. 장소 검색 함수
  // [기존 - 2주차 / 일부 수정 - 3주차]
  // ====================================================

  const searchPlaces = () => {
    // 검색어 앞뒤 공백 제거
    const query = keyword.trim()

    // 검색어가 비어 있는 경우
    if (!query) {
      setMessage('출발지를 입력해주세요.')
      return
    }

    // 카카오 검색 서비스가 준비되지 않은 경우
    if (!placesService.current) {
      setMessage('장소 검색 서비스를 불러오는 중입니다.')
      return
    }

    // 검색 시작
    setLoading(true)

    // 기존 메시지 초기화
    setMessage('')

    // 이전에 선택한 장소 초기화
    setSelectedId('')

    // 카카오 장소 검색 API 호출
    placesService.current.keywordSearch(
      query,
      (data: Place[], status: string) => {
        // 검색 완료
        setLoading(false)

        const kakao = window.kakao

        // 검색 성공
        if (status === kakao.maps.services.Status.OK) {
          // [기존 - 2주차]
          // 검색 결과를 places에 저장
          setPlaces(data)

          // [수정 - 3주차]
          // 기존에는 setMapPlaces()도 사용했지만,
          // 지금은 places에서 지도 데이터를 계산하므로 제거함.
        } else if (status === kakao.maps.services.Status.ZERO_RESULT) {
          // 검색 결과가 없는 경우
          setPlaces([])

          setMessage('검색 결과가 없습니다.')
        } else {
          // 검색 중 오류가 발생한 경우
          setPlaces([])

          setMessage('장소 검색 중 오류가 발생했습니다.')
        }
      },
    )
  }

  // ====================================================
  // 7. 검색 결과 장소 선택
  // [기존 - 2주차]
  // ====================================================

  const selectPlace = (place: Place) => {
    // 선택한 장소의 ID 저장
    setSelectedId(place.id)

    // selectedId가 변경되면
    // BaseKakaoMap에서 해당 마커를 강조함.
  }

  // ====================================================
  // 8. 멤버 출발지 저장
  // [추가 - 3주차] ★ 핵심 기능
  // ====================================================

  const saveDeparture = (place: Place) => {
    // 1. 카카오 검색 결과를 지도 데이터로 변환
    const departure = convertPlace(place)

    // 2. 선택한 멤버의 출발지 변경
    setMembers((previous) =>
      // 멤버 5명의 정보를 순서대로 확인
      previous.map((member) =>
        // 현재 선택한 멤버라면 출발지 저장
        member.id === selectedMemberId
          ? {
              ...member,
              departure,
            }
          : // 다른 멤버의 정보는 그대로 유지
            member,
      ),
    )

    // 3. 선택한 장소 ID 저장
    setSelectedId(place.id)

    // 4. 안내 메시지 초기화
    setMessage('')

    // 5. 검색창 초기화
    setKeyword('')

    // 6. 검색 결과 목록 초기화
    setPlaces([])

    // 7. 다음으로 출발지가 지정되지 않은 멤버 찾기
    const nextMember = members.find(
      (member) => member.id !== selectedMemberId && member.departure === null,
    )

    // 8. 미지정 멤버가 있다면 자동으로 선택
    if (nextMember) {
      setSelectedMemberId(nextMember.id)
    }
  }

  // ====================================================
  // 9. 멤버 출발지 삭제
  // [추가 - 3주차]
  // ====================================================

  const removeDeparture = (memberId: number) => {
    // 멤버 목록을 순회하면서
    // 해당 멤버의 출발지만 null로 변경
    setMembers((previous) =>
      previous.map((member) =>
        member.id === memberId
          ? {
              ...member,
              departure: null,
            }
          : member,
      ),
    )

    // departure가 null이 되면
    // 지도에 표시할 출발지 목록에서도 제외됨.
  }

  // ====================================================
  // 10. 지도에 표시할 데이터 생성
  // [수정 - 3주차] ★ 핵심 변경
  // ====================================================

  // [기존 - 2주차]
  // 검색된 장소만 지도에 표시했음.

  // [수정 - 3주차]
  // 검색 결과와 멤버별 출발지를 함께 표시함.

  // 10-1. 검색 결과 장소를 지도 데이터로 변환
  const searchMapPlaces: MapPlace[] = places.map(convertPlace)

  // 10-2. 출발지가 지정된 멤버만 추출
  // ==========================================
  // [수정 - 3주차]
  // 멤버별 출발지 마커 데이터 생성
  // ==========================================

  const memberMapPlaces: MapPlace[] = members
    .filter((member) => member.departure !== null)
    .map((member) => ({
      ...member.departure!,

      // 멤버별 고유 마커 ID
      id: `member-${member.id}`,

      // 마커 클릭 시 표시할 이름
      name: `${member.name}: ${member.departure!.name}`,

      // [추가 - 3주차]
      // BaseKakaoMap에 멤버 번호 전달
      // 번호에 따라 파스텔 색상과 숫자가 표시됨
      memberNumber: member.id,
    }))
  // 10-3. 검색 결과와 멤버 출발지 합치기
  const mapPlaces: MapPlace[] = [...searchMapPlaces, ...memberMapPlaces]

  // ====================================================
  // 11. 출발지 지정 완료 인원 계산
  // [추가 - 3주차]
  // ====================================================

  const completedCount = members.filter(
    (member) => member.departure !== null,
  ).length

  // 예:
  // 멤버 1, 2, 3만 지정했다면 completedCount = 3

  // ====================================================
  // 12. 지도 마커 클릭 처리
  // [기존 - 2주차]
  // ====================================================

  const handleMapPlaceClick = (place: MapPlace) => {
    // 클릭한 마커의 ID 저장
    setSelectedId(place.id)
  }

  // ====================================================
  return (
    <div className={styles.page}>
      <section className={styles.membersSection}>
        <div className={styles.heading}>
          <h2>멤버별 출발지</h2>
          <span className={styles.badge}>
            {completedCount}/{members.length}명 완료
          </span>
        </div>

        <div className={styles.memberGrid}>
          {members.map((member) => (
            <div
              key={member.id}
              className={`${styles.memberCard} ${
                selectedMemberId === member.id ? styles.memberActive : ''
              }`}
            >
              <button
                type="button"
                className={styles.memberButton}
                onClick={() => {
                  setSelectedMemberId(member.id)
                  setSelectedId(member.departure ? `member-${member.id}` : '')
                }}
              >
                <p className={styles.memberName}>{member.name}</p>
                <p className={styles.memberDeparture}>
                  {member.departure ? member.departure.name : '출발지 미지정'}
                </p>
              </button>

              {member.departure ? (
                <button
                  type="button"
                  className={styles.removeButton}
                  onClick={() => removeDeparture(member.id)}
                >
                  출발지 삭제
                </button>
              ) : (
                <p className={styles.hint}>클릭하여 출발지 지정</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className={styles.layout}>
        <section className={styles.search}>
          <div>
            <h3>{selectedMemberId}번 멤버 출발지 검색</h3>
            <p className={styles.hint}>출발지를 검색하고 선택해 주세요.</p>
          </div>

          <div className={styles.searchRow}>
            <input
              type="text"
              className={styles.input}
              aria-label="출발지 검색어"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.nativeEvent.isComposing &&
                  searchReady &&
                  !loading
                ) {
                  searchPlaces()
                }
              }}
              placeholder="예: 홍대입구역"
            />

            <button
              type="button"
              className={styles.button}
              onClick={searchPlaces}
              disabled={!searchReady || loading}
            >
              {loading ? '검색 중' : '검색'}
            </button>
          </div>

          {message && (
            <p className={styles.message} role="status">
              {message}
            </p>
          )}

          <div className={styles.results}>
            <div className={styles.heading}>
              <h3>검색 결과</h3>
              <span className={styles.hint}>{places.length}개</span>
            </div>

            {places.length === 0 && (
              <p className={styles.empty}>
                출발지를 검색하면 결과가 표시됩니다.
              </p>
            )}

            <div className={styles.resultList}>
              {places.map((place) => (
                <div
                  key={place.id}
                  className={`${styles.resultCard} ${
                    selectedId === place.id ? styles.resultSelected : ''
                  }`}
                >
                  <button
                    type="button"
                    className={styles.placeButton}
                    onClick={() => selectPlace(place)}
                  >
                    <p className={styles.placeName}>{place.place_name}</p>
                    <p className={styles.hint}>
                      {place.road_address_name || place.address_name}
                    </p>
                  </button>

                  <button
                    type="button"
                    className={`${styles.button} ${styles.saveButton}`}
                    onClick={() => saveDeparture(place)}
                  >
                    {selectedMemberId}번 멤버 출발지로 지정
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.mapSection}>
          <div className={styles.mapHeader}>
            <h3>멤버 출발지 지도</h3>
            <p className={styles.hint}>
              저장한 멤버의 출발지가 지도에 표시됩니다.
            </p>
          </div>

          <BaseKakaoMap
            places={mapPlaces}
            selectedPlaceId={selectedId}
            onPlaceClick={handleMapPlaceClick}
            height="620px"
          />

          <p className={styles.hint}>
            멤버별 출발지 {completedCount}개가 지정되었습니다.
          </p>
        </section>
      </div>
    </div>
  )
}
