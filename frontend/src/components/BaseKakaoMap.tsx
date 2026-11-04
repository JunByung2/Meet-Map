"use client";

import { useEffect, useRef, useState } from "react";
import { loadKakao } from "@/lib/kakao";
import "./maps.css";

// =========================================
// 공통 카카오 지도 (지도 담당 종은이 만든 BaseKakaoMap 을 그대로 쓰되,
// Tailwind 없이도 동작하도록 CSS 클래스로 바꾸고, 사진 추억지도에서 쓸 옵션만 추가했어요)
// =========================================

// 종은, 성혜, 다현 모두 사용할 장소 정보
export interface MapPlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  // ---- 아래는 선택 값 (다현 추억지도 / 멤버 출발지에서 사용) ----
  label?: string; // showLabels 일 때 마커 위에 항상 보여줄 글자 (없으면 말풍선 없음)
  color?: string; // 선택하지 않았을 때의 마커 색 (기본 회색)
  memberNumber?: number; // 멤버 출발지 마커일 때 멤버 번호(user_id)
}

interface BaseKakaoMapProps {
  places?: MapPlace[];
  selectedPlaceId?: string;
  onPlaceClick?: (place: MapPlace) => void;
  height?: string;
  /** true 면 label 이 있는 모든 마커 위에 이름표를 보여줘요 (추억지도 디자인). 기본 false = 선택한 장소만 */
  showLabels?: boolean;
  /** false 면 마커를 눌러도 확대하지 않고 부드럽게 이동만 해요. 기본 true (종은이 원래 동작) */
  zoomOnSelect?: boolean;
}

export default function BaseKakaoMap({
  places = [],
  selectedPlaceId,
  onPlaceClick,
  height = "480px",
  showLabels = false,
  zoomOnSelect = true,
}: BaseKakaoMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstance = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markers = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlays = useRef<any[]>([]);
  const lastFitKey = useRef("");
  const onPlaceClickRef = useRef(onPlaceClick);
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    onPlaceClickRef.current = onPlaceClick;
  }, [onPlaceClick]);

  // SVG 핀 이미지
  const makeMarkerImage = (color: string) => {
    const kakao = window.kakao;
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
        <path d="M18 2 C8 2 2 9 2 18 C2 30 18 42 18 42 C18 42 34 30 34 18 C34 9 28 2 18 2Z"
              fill="${color}" stroke="white" stroke-width="2"/>
        <circle cx="18" cy="18" r="6" fill="white"/>
      </svg>`;
    return new kakao.maps.MarkerImage(
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg),
      new kakao.maps.Size(36, 44),
      { offset: new kakao.maps.Point(18, 42) },
    );
  };

  // 지도 만들기
  useEffect(() => {
    let cancelled = false;
    loadKakao()
      .then((kakao) => {
        if (cancelled || !mapContainer.current) return;
        // 기본 지도 중심: 서울시청
        mapInstance.current = new kakao.maps.Map(mapContainer.current, {
          center: new kakao.maps.LatLng(37.5665, 126.978),
          level: 7,
        });
        setMapReady(true);
        setError("");
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 장소 / 마커 표시
  useEffect(() => {
    if (!mapReady || !mapInstance.current) return;

    const kakao = window.kakao;
    const map = mapInstance.current;

    const clear = () => {
      markers.current.forEach((m) => m.setMap(null));
      overlays.current.forEach((o) => o.setMap(null));
      markers.current = [];
      overlays.current = [];
    };
    clear();
    if (places.length === 0) return clear;

    const bounds = new kakao.maps.LatLngBounds();
    const selectedPlace = places.find((p) => p.id === selectedPlaceId);

    places.forEach((place) => {
      const position = new kakao.maps.LatLng(place.latitude, place.longitude);
      const isSelected = place.id === selectedPlaceId;

      const marker = new kakao.maps.Marker({
        map,
        position,
        title: place.name,
        image: makeMarkerImage(
          isSelected ? "#247C73" : (place.color ?? "#8B9695"),
        ),
        zIndex: isSelected ? 10 : 1,
      });
      kakao.maps.event.addListener(marker, "click", () =>
        onPlaceClickRef.current?.(place),
      );
      markers.current.push(marker);
      bounds.extend(position);

      // 이름표 (추억지도: label 이 있는 모든 마커 / 기본: 아래에서 선택한 장소만)
      if (showLabels && place.label) {
        const el = document.createElement("div");
        el.className = isSelected ? "km-label selected" : "km-label";
        el.textContent = place.label; // textContent 로 안전하게
        el.onclick = () => onPlaceClickRef.current?.(place);
        overlays.current.push(
          new kakao.maps.CustomOverlay({
            map,
            position,
            content: el,
            xAnchor: 0.5,
            yAnchor: 2.1,
            zIndex: isSelected ? 20 : 5,
          }),
        );
      }
    });

    if (zoomOnSelect) {
      // ---- 종은이 원래 동작: 선택하면 그 장소로 이동 + 확대, 선택 없으면 전체 보기 ----
      if (selectedPlace) {
        const position = new kakao.maps.LatLng(
          selectedPlace.latitude,
          selectedPlace.longitude,
        );
        map.setCenter(position);
        map.setLevel(3);
        if (!showLabels) {
          const label = document.createElement("div");
          label.className = "km-bubble";
          label.textContent = selectedPlace.name;
          overlays.current.push(
            new kakao.maps.CustomOverlay({
              map,
              position,
              content: label,
              xAnchor: 0.5,
              yAnchor: 2.1,
              zIndex: 20,
            }),
          );
        }
      } else {
        map.setBounds(bounds);
        if (places.length === 1) map.setLevel(4);
      }
    } else {
      // ---- 추억지도: 장소 목록이 바뀔 때만 전체가 보이게 맞추고, 마커 선택은 부드럽게 이동만 ----
      const fitKey = places
        .map((p) => `${p.id}:${p.latitude}:${p.longitude}`)
        .join("|");
      if (fitKey !== lastFitKey.current) {
        lastFitKey.current = fitKey;
        map.setBounds(bounds);
        if (places.length === 1) map.setLevel(4);
      }
      if (selectedPlace) {
        map.panTo(
          new kakao.maps.LatLng(
            selectedPlace.latitude,
            selectedPlace.longitude,
          ),
        );
      }
    }

    return clear;
  }, [places, selectedPlaceId, mapReady, showLabels, zoomOnSelect]);

  return (
    <div className="km-wrap">
      {error && <p className="km-error">{error}</p>}
      <div ref={mapContainer} style={{ height }} className="km-map" />
    </div>
  );
}
