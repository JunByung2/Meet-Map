'use client'

import styles from './map.module.css'
import { useEffect, useRef, useState } from 'react'

// =========================================
// 1. 공통 장소 데이터 타입
// =========================================

// 종은, 성혜, 다현 모두 사용할 장소 정보
export interface MapPlace {
  id: string
  name: string
  latitude: number
  longitude: number

  // [추가 - 3주차]
  // 멤버 출발지일 때만 1~5의 번호를 전달
  // 검색 결과 등 일반 장소에서는 생략 가능
  memberNumber?: number
}

// 공통 지도에 전달할 값
interface BaseKakaoMapProps {
  places?: MapPlace[]
  selectedPlaceId?: string
  onPlaceClick?: (place: MapPlace) => void
  height?: string
}

// 카카오 SDK 객체를 사용하기 위한 타입
declare global {
  interface Window {
    kakao: any
  }
}

// =========================================
// 2. 멤버별 파스텔 색상
// [추가 - 3주차]
// =========================================

// 각 멤버에게 고유한 파스텔 색상을 지정
// 공통 지도에서도 재사용할 수 있도록 컴포넌트 밖에 선언
const MEMBER_COLORS: Record<number, string> = {
  1: '#A8DCD1', // 파스텔 민트
  2: '#AFCBF3', // 파스텔 하늘색
  3: '#F6D6A8', // 파스텔 살구색
  4: '#D5C2F1', // 파스텔 라벤더
  5: '#F3BFD0', // 파스텔 핑크
}

// 일반 검색 결과 마커 색상
const DEFAULT_MARKER_COLOR = '#8B9695'

// 선택된 일반 장소 마커 색상
const SELECTED_MARKER_COLOR = '#247C73'

// =========================================
// 3. 공통 카카오 지도 컴포넌트
// =========================================

export default function BaseKakaoMap({
  places = [],
  selectedPlaceId,
  onPlaceClick,
  height = '480px',
}: BaseKakaoMapProps) {
  // 지도가 표시될 HTML 요소
  const mapContainer = useRef<HTMLDivElement>(null)

  // 생성된 지도 객체
  const mapInstance = useRef<any>(null)

  // 지도에 표시한 마커 목록
  const markers = useRef<any[]>([])

  // 선택한 장소의 이름 말풍선
  const selectedOverlay = useRef<any>(null)

  // 최신 클릭 함수를 저장
  const onPlaceClickRef = useRef(onPlaceClick)

  // 지도 준비 여부
  const [mapReady, setMapReady] = useState(false)

  // 오류 메시지
  const [error, setError] = useState('')

  // 부모 컴포넌트의 클릭 함수가 바뀌면 업데이트
  useEffect(() => {
    onPlaceClickRef.current = onPlaceClick
  }, [onPlaceClick])

  // =========================================
  // 4. 마커 이미지 생성
  // [수정 - 3주차]
  // =========================================

  // [기존 - 2주차]
  // 색상(color)만 전달받아 마커를 생성했음.
  //
  // [수정 - 3주차]
  // 멤버 번호(memberNumber)도 전달받아
  // 마커 가운데 숫자를 표시하도록 변경.
  //
  // memberNumber가 없다면 기존처럼
  // 가운데 흰색 원이 있는 일반 마커를 생성함.

  const makeMarkerImage = (color: string, memberNumber?: number) => {
    const kakao = window.kakao

    // 멤버 번호가 있는지 확인
    const hasMemberNumber = memberNumber !== undefined

    // [추가 - 3주차]
    // 멤버 마커라면 숫자를 표시하고,
    // 일반 검색 마커라면 흰색 원을 표시
    const markerCenter = hasMemberNumber
      ? `
        <text
          x="18"
          y="23"
          text-anchor="middle"
          font-size="15"
          font-weight="700"
          fill="#213C40"
        >
          ${memberNumber}
        </text>
      `
      : `
        <circle
          cx="18"
          cy="18"
          r="6"
          fill="white"
        />
      `

    // SVG로 지도 핀 생성
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg"
           width="36"
           height="44"
           viewBox="0 0 36 44">

        <path
          d="M18 2 C8 2 2 9 2 18
             C2 30 18 42 18 42
             C18 42 34 30 34 18
             C34 9 28 2 18 2Z"
          fill="${color}"
          stroke="white"
          stroke-width="2"
        />

        ${markerCenter}

      </svg>
    `

    // SVG를 이미지 주소로 변환
    const imageUrl =
      'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)

    // 카카오 지도에서 사용할 마커 이미지 생성
    return new kakao.maps.MarkerImage(imageUrl, new kakao.maps.Size(36, 44), {
      offset: new kakao.maps.Point(18, 42),
    })
  }

  // =========================================
  // 5. 카카오 지도 SDK 로드
  // [기존 - 2주차]
  // =========================================

  useEffect(() => {
    const appKey = process.env.NEXT_PUBLIC_KAKAO_JS_KEY

    if (!appKey) {
      setError('카카오 JavaScript 키가 설정되지 않았습니다.')
      return
    }

    let cancelled = false

    // SDK 로드 후 지도 생성
    const initializeMap = () => {
      if (!window.kakao?.maps) return

      window.kakao.maps.load(() => {
        if (cancelled || !mapContainer.current) {
          return
        }

        const kakao = window.kakao

        // 기본 지도 중심: 서울시청
        const center = new kakao.maps.LatLng(37.5665, 126.978)

        // 지도 생성
        mapInstance.current = new kakao.maps.Map(mapContainer.current, {
          center,
          level: 7,
        })

        setMapReady(true)
        setError('')
      })
    }

    // SDK가 이미 있다면 바로 초기화
    if (window.kakao?.maps) {
      initializeMap()

      return () => {
        cancelled = true
      }
    }

    // SDK script 태그 확인
    const scriptId = 'kakao-map-sdk'

    let script = document.getElementById(scriptId) as HTMLScriptElement | null

    if (!script) {
      script = document.createElement('script')
      script.id = scriptId

      // services 라이브러리 포함
      script.src =
        'https://dapi.kakao.com/v2/maps/sdk.js' +
        `?appkey=${appKey}&autoload=false&libraries=services`

      script.async = true
      document.head.appendChild(script)
    }

    // 로드 성공
    script.addEventListener('load', initializeMap)

    // 로드 실패
    const handleError = () => {
      if (!cancelled) {
        setError('카카오 지도를 불러오지 못했습니다.')
      }
    }

    script.addEventListener('error', handleError)

    return () => {
      cancelled = true

      script?.removeEventListener('load', initializeMap)

      script?.removeEventListener('error', handleError)
    }
  }, [])

  // =========================================
  // 6. 장소 및 마커 표시
  // [수정 - 3주차]
  // =========================================

  useEffect(() => {
    // 지도 생성 전에는 실행하지 않음
    if (!mapReady || !mapInstance.current) {
      return
    }

    const kakao = window.kakao
    const map = mapInstance.current

    // 기존 마커 제거
    markers.current.forEach((marker) => {
      marker.setMap(null)
    })

    markers.current = []

    // 기존 말풍선 제거
    if (selectedOverlay.current) {
      selectedOverlay.current.setMap(null)
      selectedOverlay.current = null
    }

    // 표시할 장소가 없다면 종료
    if (places.length === 0) return

    // 모든 장소가 보이도록 범위 계산
    const bounds = new kakao.maps.LatLngBounds()

    // 선택한 장소 찾기
    const selectedPlace = places.find((place) => place.id === selectedPlaceId)

    // 장소마다 마커 생성
    places.forEach((place) => {
      const position = new kakao.maps.LatLng(place.latitude, place.longitude)

      const isSelected = place.id === selectedPlaceId

      // =====================================
      // [추가 - 3주차]
      // 멤버 출발지인지 확인
      // =====================================

      const isMemberMarker =
        place.memberNumber !== undefined &&
        MEMBER_COLORS[place.memberNumber] !== undefined

      // =====================================
      // [수정 - 3주차]
      // 마커 색상 결정
      // =====================================

      // 1. 멤버 출발지라면 멤버 고유 파스텔 색상
      // 2. 일반 장소가 선택됐다면 청록색
      // 3. 나머지 일반 장소는 회색
      //
      // 멤버 마커는 선택하더라도
      // 고유한 파스텔 색상을 유지함.

      let markerColor = DEFAULT_MARKER_COLOR

      if (isMemberMarker) {
        markerColor = MEMBER_COLORS[place.memberNumber!]
      } else if (isSelected) {
        markerColor = SELECTED_MARKER_COLOR
      }

      // =====================================
      // [수정 - 3주차]
      // 번호가 포함된 마커 생성
      // =====================================

      const marker = new kakao.maps.Marker({
        map,
        position,
        title: place.name,

        // 멤버 마커라면 번호 전달
        // 일반 마커라면 번호 없이 생성
        image: makeMarkerImage(
          markerColor,
          isMemberMarker ? place.memberNumber : undefined,
        ),

        // 선택한 마커를 앞쪽에 표시
        zIndex: isSelected ? 10 : 1,
      })

      // 마커 클릭 시 부모 컴포넌트에 장소 전달
      kakao.maps.event.addListener(marker, 'click', () => {
        onPlaceClickRef.current?.(place)
      })

      markers.current.push(marker)
      bounds.extend(position)
    })

    // =====================================
    // 7. 선택한 장소 강조 및 말풍선
    // [기존 - 2주차]
    // =====================================

    if (selectedPlace) {
      const position = new kakao.maps.LatLng(
        selectedPlace.latitude,
        selectedPlace.longitude,
      )

      // 선택한 장소로 지도 이동
      map.setCenter(position)
      map.setLevel(3)

      // 장소 이름을 표시할 HTML 요소
      const label = document.createElement('div')

      // textContent로 안전하게 이름 삽입
      label.textContent = selectedPlace.name

      // 말풍선 디자인
      label.style.backgroundColor = '#213C40'
      label.style.color = '#FFFFFF'
      label.style.padding = '8px 14px'
      label.style.borderRadius = '20px'
      label.style.fontSize = '13px'
      label.style.fontWeight = '600'
      label.style.whiteSpace = 'nowrap'
      label.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)'

      // 선택한 마커 위에 장소 이름 표시
      selectedOverlay.current = new kakao.maps.CustomOverlay({
        map,
        position,
        content: label,
        xAnchor: 0.5,
        yAnchor: 2.1,
        zIndex: 20,
      })
    } else {
      // 선택된 장소가 없으면 전체 마커 표시
      map.setBounds(bounds)

      // 검색 결과가 하나라면 적절히 확대
      if (places.length === 1) {
        map.setLevel(4)
      }
    }

    // 장소 목록이 바뀔 때 기존 마커 정리
    return () => {
      markers.current.forEach((marker) => {
        marker.setMap(null)
      })

      markers.current = []

      if (selectedOverlay.current) {
        selectedOverlay.current.setMap(null)
        selectedOverlay.current = null
      }
    }
  }, [places, selectedPlaceId, mapReady])

  // =========================================
  // 8. 공통 지도 화면
  // [기존 - 2주차]
  // =========================================

  return (
    <div>
      {error && (
        <p className={styles.message} role="alert">
          {error}
        </p>
      )}

      <div ref={mapContainer} style={{ height }} className={styles.mapCanvas} />
    </div>
  )
}
