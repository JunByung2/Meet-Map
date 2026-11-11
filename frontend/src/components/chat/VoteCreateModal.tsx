"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { PlaceValue } from "@/lib/photos";
import { usePlaceSearch } from "@/lib/usePlaceSearch";
import styles from "./vote.module.css";

/** text: 입력한 항목 이름 / place: 검색해서 고른 장소 (직접 적기만 했으면 null) */
type Option = { key: number; text: string; place: PlaceValue | null };

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

let nextKey = 1;
const blank = (): Option => ({ key: nextKey++, text: "", place: null });

/**
 * 항목 한 줄: 이름을 직접 적어도 되고, [검색]으로 카카오 장소를 골라도 된다.
 * 검색해서 고르면 주소·좌표가 함께 저장돼 지도에 표시할 수 있다.
 */
function OptionRow({
  index,
  option,
  removable,
  onChange,
  onRemove,
}: {
  index: number;
  option: Option;
  removable: boolean;
  onChange: (patch: Partial<Option>) => void;
  onRemove: () => void;
}) {
  const search = usePlaceSearch();
  const [showResults, setShowResults] = useState(false);

  function runSearch() {
    const q = option.text.trim();
    search.setKeyword(q);
    setShowResults(true);
    void search.run(q);
  }

  return (
    <div className={styles.row}>
      <div className={styles.rowLine}>
        <input
          className="input ime-ko"
          lang="ko"
          value={option.text}
          maxLength={200}
          placeholder={`항목${index + 1} (검색하거나 직접 입력)`}
          aria-label={`항목${index + 1}`}
          onChange={(e) => {
            const text = e.target.value;
            setShowResults(false);
            // 고른 장소와 다른 글자가 되면 직접 입력한 항목으로 본다
            onChange({
              text,
              place:
                option.place && option.place.name === text.trim()
                  ? option.place
                  : null,
            });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runSearch();
            }
          }}
        />
        <button
          type="button"
          className="btn secondary sm"
          style={{ flexShrink: 0, whiteSpace: "nowrap" }}
          disabled={!search.ready || search.loading || !option.text.trim()}
          onClick={runSearch}
        >
          {search.loading ? "…" : "검색"}
        </button>
        {removable && (
          <button
            type="button"
            className={styles.remove}
            onClick={onRemove}
            aria-label="항목 삭제"
          >
            ✕
          </button>
        )}
      </div>

      {option.place && <p className={styles.when}>📍 {option.place.address}</p>}

      {showResults && search.error && (
        <p className={styles.msg}>{search.error}</p>
      )}
      {showResults && !search.error && search.message && (
        <p className={styles.when}>{search.message}</p>
      )}

      {showResults && search.results.length > 0 && (
        <ul className={styles.found} aria-label="장소 검색 결과">
          {search.results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  onChange({
                    text: r.name,
                    place: {
                      id: r.id,
                      name: r.name,
                      address: r.address,
                      lat: r.lat,
                      lng: r.lng,
                    },
                  });
                  setShowResults(false);
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
    </div>
  );
}

export default function VoteCreateModal({
  groupId,
  initialPlaces,
  onClose,
  onCreated,
}: {
  groupId: number;
  /** 약속장소 추천에서 담아 온 장소 (없으면 빈 항목 2개로 시작) */
  initialPlaces?: PlaceValue[];
  onClose: () => void;
  /** 후보가 모두 저장된 뒤 호출 — 채팅방에 투표 카드를 올린다 */
  onCreated: (title: string, pollId: string) => Promise<void> | void;
}) {
  const [title, setTitle] = useState("");
  const [options, setOptions] = useState<Option[]>(() => {
    const seeded: Option[] = (initialPlaces ?? [])
      .slice(0, MAX_OPTIONS)
      .map((place) => ({ key: nextKey++, text: place.name, place }));
    while (seeded.length < MIN_OPTIONS) seeded.push(blank());
    return seeded;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const patch = (key: number, p: Partial<Option>) =>
    setOptions((cur) => cur.map((o) => (o.key === key ? { ...o, ...p } : o)));

  async function submit() {
    setError("");
    const t = title.trim();
    if (!t) return setError("투표 제목을 적어 주세요.");
    const texts = options.map((o) => o.text.trim());
    if (texts.some((x) => !x))
      return setError(
        "모든 항목을 입력해 주세요. 쓰지 않을 항목은 ✕ 로 지워요.",
      );
    if (new Set(texts.map((x) => x.toLowerCase())).size !== texts.length)
      return setError("같은 이름의 항목이 있어요. 서로 다르게 적어 주세요.");
    if (options.length < MIN_OPTIONS)
      return setError(`항목은 ${MIN_OPTIONS}개 이상이어야 투표할 수 있어요.`);
    setBusy(true);
    const pollId = crypto.randomUUID(); // 이 투표의 후보들을 하나로 묶는 번호
    try {
      for (const o of options) {
        const name = o.text.trim();
        // 검색해서 고른 장소와 같은 이름일 때만 주소·좌표를 함께 저장한다
        const place = o.place && o.place.name === name ? o.place : null;
        await api(`/groups/${groupId}/meeting-candidates`, {
          method: "POST",
          body: {
            title: t,
            location: name,
            place_id: place?.id || null,
            place_address: place?.address || null,
            place_lat: place ? place.lat : null,
            place_lng: place ? place.lng : null,
            poll_id: pollId,
          },
        });
      }
      await onCreated(t, pollId);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "투표를 만들지 못했어요.");
      setBusy(false);
    }
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="투표 만들기"
    >
      <div className={styles.modal}>
        <div className={styles.head}>
          <h2>투표 만들기</h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="닫기"
            disabled={busy}
          >
            ✕
          </button>
        </div>

        <label className={styles.label} htmlFor="vote-title">
          투표 제목
        </label>
        <input
          id="vote-title"
          className="input ime-ko"
          lang="ko"
          autoFocus
          value={title}
          maxLength={100}
          placeholder="예: 이번 주말 모임 어디서 할까?"
          onChange={(e) => setTitle(e.target.value)}
        />

        <label className={styles.label}>항목</label>
        <p className={styles.when}>
          이름만 적어도 되고, 장소는 검색해서 고르면 주소와 지도 정보가 함께
          저장돼요.
        </p>
        {options.map((o, i) => (
          <OptionRow
            key={o.key}
            index={i}
            option={o}
            removable={options.length > MIN_OPTIONS}
            onChange={(p) => patch(o.key, p)}
            onRemove={() =>
              setOptions((cur) => cur.filter((x) => x.key !== o.key))
            }
          />
        ))}
        {options.length < MAX_OPTIONS && (
          <button
            type="button"
            className={styles.add}
            onClick={() => setOptions((cur) => [...cur, blank()])}
          >
            + 항목 추가
          </button>
        )}

        {error && <p className={styles.msg}>{error}</p>}

        <div className={styles.actions}>
          <button
            type="button"
            className="btn secondary"
            onClick={onClose}
            disabled={busy}
          >
            취소
          </button>
          <button
            type="button"
            className="btn"
            onClick={submit}
            disabled={busy}
          >
            {busy ? "만드는 중…" : "투표 올리기"}
          </button>
        </div>
      </div>
    </div>
  );
}
