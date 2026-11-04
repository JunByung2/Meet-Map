"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { MapPlace } from "../map/BaseKakaoMap";
import css from "./nearby.module.css";

// 서버(nearby_service.py)의 종류·필터 키와 같아야 한다. 첫 번째 필터가 기본값이다.
const TABS: { key: string; label: string; filters: [string, string][] }[] = [
  {
    key: "restaurant",
    label: "식당",
    filters: [
      ["all", "전체"],
      ["korean", "한식"],
      ["japanese", "일식"],
      ["western", "양식"],
      ["chinese", "중식"],
      ["snack", "분식"],
      ["meat", "고기"],
    ],
  },
  {
    key: "cafe",
    label: "카페",
    filters: [
      ["all", "전체"],
      ["independent", "프랜차이즈 제외"],
      ["dessert", "디저트"],
      ["theme", "테마카페"],
    ],
  },
  {
    key: "play",
    label: "놀 곳",
    filters: [
      ["boardgame", "보드게임"],
      ["escape", "방탈출"],
      ["karaoke", "노래방"],
      ["bowling", "볼링"],
      ["billiards", "당구"],
      ["arcade", "오락실"],
    ],
  },
  { key: "bar", label: "술집", filters: [["all", "전체"]] },
];

const NEARBY_MARKER_COLOR = "#D9822B"; // 지도에서 역(회색)·멤버(파스텔)와 구분되는 주황

interface Place {
  id: string;
  name: string;
  category_short: string;
  address: string;
  phone: string;
  url: string | null;
  distance_meters: number | null;
  latitude: number;
  longitude: number;
}

interface NearbyResult {
  places: Place[];
  has_more: boolean;
  page: number;
}

/** 투표 후보로 담는 장소 (투표 만들기 창의 PlaceValue 와 같은 모양) */
export interface PickedPlace {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export default function NearbyPlaces({
  groupId,
  planId,
  stationId,
  stationName,
  picked = [],
  onToggle,
  onPlacesChange,
  selectedId = "",
  onSelect,
}: {
  groupId: string;
  planId: string;
  stationId: string;
  stationName: string;
  /** 투표 후보로 담은 장소들 (onToggle 이 없으면 담기 버튼을 숨긴다) */
  picked?: PickedPlace[];
  onToggle?: (place: PickedPlace) => void;
  /** 지도에 찍을 장소가 바뀔 때 알려 준다. 접으면 빈 목록. (부모에서 안정된 함수로 넘길 것) */
  onPlacesChange?: (stationId: string, places: MapPlace[]) => void;
  /** 지도에서 선택된 마커 id ("nearby-장소id") */
  selectedId?: string;
  onSelect?: (mapId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("restaurant");
  const [option, setOption] = useState("all");
  const [places, setPlaces] = useState<Place[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const ticket = useRef(0);

  const tab = TABS.find((t) => t.key === category) ?? TABS[0];

  async function load(cat: string, opt: string, pg: number) {
    const mine = ++ticket.current;
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({
        station_id: stationId,
        category: cat,
        filter: opt,
        page: String(pg),
      });
      const data = await api<NearbyResult>(
        `/groups/${groupId}/place-plans/${planId}/places?${qs.toString()}`,
      );
      if (mine !== ticket.current) return; // 더 최근 요청이 있으면 버린다
      setPlaces((prev) =>
        pg === 1
          ? data.places
          : [
              ...prev,
              ...data.places.filter((p) => !prev.some((q) => q.id === p.id)),
            ],
      );
      setPage(data.page);
      setHasMore(data.has_more);
    } catch (err) {
      if (mine !== ticket.current) return;
      if (pg === 1) setPlaces([]);
      setError(
        err instanceof Error ? err.message : "장소를 불러오지 못했어요.",
      );
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }

  // 펼쳤을 때, 종류·필터·역이 바뀔 때 1쪽부터 다시 불러온다. (펼치기 전에는 API를 쓰지 않는다)
  useEffect(() => {
    if (open) void load(category, option, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category, option, stationId]);

  // 펼쳐 있는 동안 불러온 장소를 지도 마커로 알려 준다. 접으면 비운다.
  useEffect(() => {
    if (!open) {
      onPlacesChange?.(stationId, []);
      return;
    }
    onPlacesChange?.(
      stationId,
      places.map((p) => ({
        id: `nearby-${p.id}`,
        name: p.name,
        latitude: p.latitude,
        longitude: p.longitude,
        color: NEARBY_MARKER_COLOR,
      })),
    );
  }, [open, places, stationId, onPlacesChange]);

  // 카드가 사라질 때(다시 추천 등) 마커도 같이 지운다.
  useEffect(
    () => () => onPlacesChange?.(stationId, []),
    [stationId, onPlacesChange],
  );

  function selectTab(next: (typeof TABS)[number]) {
    setCategory(next.key);
    setOption(next.filters[0][0]);
  }

  return (
    <div className={css.wrap}>
      <button
        type="button"
        className={css.toggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "주변 장소 닫기" : `${stationName} 주변 맛집·카페·놀 곳 보기`}
      </button>

      {open && (
        <div>
          <div role="tablist" className={css.tabs}>
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                className={css.tab}
                aria-selected={category === t.key}
                onClick={() => selectTab(t)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab.filters.length > 1 && (
            <div className={css.filters}>
              {tab.filters.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={css.filter}
                  aria-pressed={option === key}
                  onClick={() => setOption(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <p className={css.note}>
            역에서 가까운 순 · 반경 600m · 지도에는 <span className={css.dot} />
            주황색 마커로 표시돼요.
          </p>

          {error && (
            <p role="alert" className={css.error}>
              {error}
            </p>
          )}
          {loading && places.length === 0 && (
            <p role="status" className={css.empty}>
              불러오는 중…
            </p>
          )}
          {!loading && !error && places.length === 0 && (
            <p className={css.empty}>
              이 조건에 맞는 장소가 없어요. 다른 필터를 눌러 보세요.
            </p>
          )}

          <ul className={css.list}>
            {places.map((p) => {
              const mapId = `nearby-${p.id}`;
              const isSelected = selectedId === mapId;
              const isPicked = picked.some((q) => q.id === p.id);
              return (
                <li
                  key={p.id}
                  className={`${css.item} ${isSelected ? css.itemSelected : ""}`}
                >
                  <div className={css.itemTop}>
                    <span className={css.name}>{p.name}</span>
                    {p.distance_meters !== null && (
                      <span className={css.dist}>{p.distance_meters}m</span>
                    )}
                  </div>
                  <div className={css.meta}>
                    {p.category_short}
                    {p.address ? ` · ${p.address}` : ""}
                    {p.phone ? ` · ${p.phone}` : ""}
                  </div>
                  <div className={css.actions}>
                    {onToggle && (
                      <button
                        type="button"
                        className={css.pick}
                        aria-pressed={isPicked}
                        onClick={() =>
                          onToggle({
                            id: p.id,
                            name: p.name,
                            address: p.address,
                            lat: p.latitude,
                            lng: p.longitude,
                          })
                        }
                      >
                        {isPicked ? "✓ 후보에 담김" : "+ 투표 후보 담기"}
                      </button>
                    )}
                    {onSelect && (
                      <button
                        type="button"
                        className={css.sub}
                        aria-pressed={isSelected}
                        onClick={() => onSelect(mapId)}
                      >
                        지도
                      </button>
                    )}
                    {p.url && (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={css.sub}
                      >
                        카카오맵
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {hasMore && (
            <button
              type="button"
              className={css.more}
              disabled={loading}
              onClick={() => void load(category, option, page + 1)}
            >
              {loading ? "불러오는 중…" : "더 보기"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
