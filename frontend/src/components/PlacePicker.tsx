"use client";

import type { PlaceValue } from "@/lib/photos";
import { usePlaceSearch } from "@/lib/usePlaceSearch";
import "./maps.css";

/**
 * "어디에서 찍었나요?" — 카카오 장소 검색으로 사진의 장소를 고르는 입력 (사진 올리기 / 사진 상세에서 사용)
 * 고른 장소는 사진과 함께 저장되고, 추억지도에 마커로 표시돼요. 장소는 선택 사항이에요.
 */
export default function PlacePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: PlaceValue | null;
  onChange: (place: PlaceValue | null) => void;
  disabled?: boolean;
}) {
  const search = usePlaceSearch();

  return (
    <div className="pp">
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="pp-input">
          장소 검색 <span className="meta">(선택)</span>
        </label>
        <div className="pp-searchrow">
          <input
            id="pp-input"
            className="input"
            value={search.keyword}
            disabled={disabled}
            onChange={(e) => search.setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                search.run();
              }
            }}
            placeholder="장소를 검색해 주세요"
          />
          <button type="button" className="btn secondary" onClick={() => search.run()} disabled={disabled || !search.ready || search.loading}>
            {search.loading ? "검색 중" : "검색"}
          </button>
        </div>
      </div>

      {search.error && <p className="error">{search.error} 장소 없이도 사진은 저장할 수 있어요.</p>}
      {!search.error && search.message && <p className="pp-msg">{search.message}</p>}

      {search.results.length > 0 && (
        <ul className="pp-results" aria-label="장소 검색 결과">
          {search.results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="pp-result"
                onClick={() => {
                  onChange({ id: r.id, name: r.name, address: r.address, lat: r.lat, lng: r.lng });
                  search.clear();
                  search.setKeyword("");
                }}
              >
                <strong>{r.name}</strong>
                <span>{r.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {value ? (
        <div className="pp-card" data-testid="selected-place">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
          <strong>{value.name}</strong>
          {value.address && <span>{value.address}</span>}
          <em>✓ 추억지도에 표시</em>
          {!disabled && (
            <button type="button" className="pp-clear" onClick={() => onChange(null)}>
              장소 해제
            </button>
          )}
        </div>
      ) : (
        <p className="meta">장소를 연결하지 않아도 사진을 저장할 수 있어요.</p>
      )}
    </div>
  );
}
