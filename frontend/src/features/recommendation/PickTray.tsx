"use client";

import type { PickedPlace } from "./NearbyPlaces";
import css from "./nearby.module.css";

/** 투표 후보 고정 상자: 담은 장소들과 "채팅에서 투표 만들기" 버튼 하나. */
export default function PickTray({
  picks,
  max,
  notice,
  onRemove,
  onSend,
}: {
  picks: PickedPlace[];
  max: number;
  notice: string;
  onRemove: (place: PickedPlace) => void;
  onSend: () => void;
}) {
  if (picks.length === 0) return null;
  const ready = picks.length >= 2;
  return (
    <div className={css.tray} role="region" aria-label="투표 후보">
      <div className={css.trayList}>
        <p className={css.trayTitle}>
          투표 후보 {picks.length}/{max}
        </p>
        {picks.map((p) => (
          <span key={p.id} className={css.chipTag}>
            <span>{p.name}</span>
            <button
              type="button"
              className={css.chipX}
              aria-label={`${p.name} 빼기`}
              onClick={() => onRemove(p)}
            >
              ✕
            </button>
          </span>
        ))}
        {(notice || !ready) && (
          <p className={css.trayNote} role="status">
            {notice || "투표하려면 2개 이상 담아 주세요."}
          </p>
        )}
      </div>
      <button
        type="button"
        className={css.send}
        disabled={!ready}
        onClick={onSend}
      >
        채팅에서 투표 만들기
      </button>
    </div>
  );
}
