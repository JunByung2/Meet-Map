"use client";

import { useEffect, useState } from "react";
import { formatDayHeading } from "@/lib/photos";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n: number) => String(n).padStart(2, "0");

/** 달력 칸 하나(하루)에 보여 줄 정보 */
export type DayCell = {
  count: number; // 그날 사진 장수
  coverUrl: string | null; // 그날 대표 사진 주소
  hasRecord: boolean; // 그날 약속 기록이 있는지
  records: { id: number; title: string; place: string | null }[]; // 그날 약속 기록
  items: { key: string; label: string; place: string | null; count: number }[]; // 그날 사진 묶음
};

/**
 * 사진 페이지의 달력 보기 (셋로그의 달력처럼 작은 시트로 열린다).
 * - 사진이 있는 날은 그날의 대표 사진이 칸에 보이고, 약속 기록이 있는 날은 작은 점이 보인다.
 * - 날을 누르면 달력 아래의 정보 칸에 그날의 대표 사진과 약속 기록·사진 묶음의 정보(장소 · 제목 · 장수)가 나온다.
 *   (약속 기록으로 가는 링크는 여기에 없다. "이 날 사진 보기"로 들어간 사진 목록 위에 있다.)
 *   정보 칸의 높이와 달력의 줄 수는 늘 같아서, 날을 눌러도 달력 크기가 바뀌지 않고 버튼 자리도 그대로다.
 * - "이 날 사진 보기"를 누르면 사진 목록이 그 날짜만 보이도록 걸러진다.
 * - 대표 사진은 사진 상세 화면에서 팀원 누구나 바꿀 수 있다.
 */
export default function PhotoCalendar({
  days,
  selected,
  onSelect,
  onClose,
  inline = false,
}: {
  days: Map<string, DayCell>; // 날짜(YYYY-MM-DD, 한국 시간) -> 그날 정보
  selected: string | null; // 사진 목록에 걸려 있는 날짜
  onSelect: (day: string | null) => void;
  onClose: () => void;
  /** true 면 화면 가운데 뜨는 시트가 아니라 페이지 안에 그대로 놓는다 (추억 화면의 지난 기록 칸) */
  inline?: boolean;
}) {
  // 처음에 보여 줄 달: 고른 날짜의 달 → 가장 최근 사진이 있는 달 → 이번 달
  const [ym, setYm] = useState(() => {
    const keys = Array.from(days.entries())
      .filter(([, v]) => v.count > 0)
      .map(([k]) => k)
      .sort();
    const base = selected ?? keys[keys.length - 1] ?? new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    const [y, m] = base.split("-").map(Number);
    return { y, m };
  });
  const [picked, setPicked] = useState<string | null>(selected); // 아래 정보 칸에 보여 줄 날
  const [jumping, setJumping] = useState(false); // 날짜를 직접 입력하는 중

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { y, m } = ym;
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 1일의 요일 (일=0)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // 그달의 마지막 날
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

  let monthDays = 0;
  let monthPhotos = 0;
  for (let d = 1; d <= last; d += 1) {
    const n = days.get(`${y}-${pad(m)}-${pad(d)}`)?.count ?? 0;
    if (n > 0) {
      monthDays += 1;
      monthPhotos += n;
    }
  }

  // 달마다 4~6줄로 달라지지 않게 늘 6줄(42칸)로 그린다
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: last }, (_, i) => i + 1)];
  while (cells.length < 42) cells.push(null);

  function move(delta: number) {
    setYm(({ y: yy, m: mm }) => {
      const d = new Date(Date.UTC(yy, mm - 1 + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
    });
  }

  // 직접 입력한 날짜로 바로 간다: 그 달을 보여 주고 그날을 골라 정보 칸에 띄운다
  function jumpTo(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const [yy, mm] = value.split("-").map(Number);
    if (!yy || !mm) return;
    setYm({ y: yy, m: mm });
    setPicked(value);
    setJumping(false);
  }

  const info = picked ? days.get(picked) : undefined;
  const pickedPhotos = info?.count ?? 0;
  const canOpen = pickedPhotos > 0 || (info?.records.length ?? 0) > 0; // 사진이 없어도 약속 기록만 있는 날은 열어 볼 수 있다

  return (
    <div
      className={inline ? "pc-back pc-inline-wrap" : "pc-back"}
      role={inline ? undefined : "dialog"}
      aria-modal={inline ? undefined : true}
      aria-label="달력으로 사진 보기"
      onClick={inline ? undefined : onClose}
    >
      <div className="pc-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pc-top">
          <span className="pc-grab" aria-hidden="true" />
          <button type="button" className="pc-x" aria-label="달력 닫기" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="pc-head">
          <button type="button" className="pc-nav" aria-label="이전 달" onClick={() => move(-1)}>
            ‹
          </button>
          {jumping ? (
            <input
              className="pc-jump"
              type="date"
              autoFocus
              aria-label="날짜 직접 입력 (예: 2026-10-28)"
              defaultValue={picked ?? `${y}-${pad(m)}-01`}
              onChange={(e) => jumpTo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.nativeEvent.stopPropagation(); // 시트 전체가 닫히지 않고 입력만 닫는다
                  setJumping(false);
                }
              }}
            />
          ) : (
            <button type="button" className="pc-title" aria-label="날짜 직접 입력하기" onClick={() => setJumping(true)}>
              {y}년 {m}월 <span aria-hidden="true">▾</span>
            </button>
          )}
          <button type="button" className="pc-nav" aria-label="다음 달" onClick={() => move(1)}>
            ›
          </button>
        </div>

        <div className="pc-stats">
          <div>
            <b>{monthPhotos}장</b>
            <span>이번 달 사진</span>
          </div>
          <div>
            <b>{monthDays}일</b>
            <span>사진 남긴 날</span>
          </div>
        </div>

        <div className="pc-week" aria-hidden="true">
          {WEEK.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="pc-grid">
          {cells.map((d, i) => {
            if (d === null) return <span key={`e${i}`} />;
            const key = `${y}-${pad(m)}-${pad(d)}`;
            const cell = days.get(key);
            const n = cell?.count ?? 0;
            const hasRecord = !!cell?.hasRecord;
            const on = picked === key;
            const usable = n > 0 || hasRecord;
            return (
              <button
                key={key}
                type="button"
                disabled={!usable}
                className={`pc-day${n > 0 ? " has" : ""}${n > 0 && cell?.coverUrl ? " img" : ""}${hasRecord ? " rec" : ""}${on ? " on" : ""}${key === today ? " today" : ""}`}
                aria-label={`${m}월 ${d}일${n > 0 ? ` 사진 ${n}장` : ""}${hasRecord ? " 약속 기록 있음" : ""}`}
                aria-pressed={on}
                onClick={() => setPicked(on ? null : key)}
              >
                {n > 0 && cell?.coverUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cell.coverUrl} alt="" loading="lazy" />
                )}
                <span className="pc-num">{d}</span>
                {n > 0 && <i aria-hidden="true">{n > 99 ? "99+" : n}</i>}
                {hasRecord && <em className="pc-dot" aria-hidden="true" />}
              </button>
            );
          })}
        </div>

        {/* 고른 날의 정보 칸: 높이가 고정이라 내용이 많으면 이 칸 안에서만 스크롤된다 */}
        <div className="pc-detail" aria-live="polite">
          {picked && !info ? (
            <p className="pc-hint">{formatDayHeading(picked)}에는 사진도 약속 기록도 없어요.</p>
          ) : picked && info ? (
            <>
              <div className="pc-cover">
                {info.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={info.coverUrl} alt="이 날의 대표 사진" />
                ) : (
                  <span className="pc-noimg" aria-hidden="true">
                    {info.records.length > 0 ? "📌" : ""}
                  </span>
                )}
              </div>
              <div className="pc-info">
                <h4>
                  {formatDayHeading(picked)}
                  {pickedPhotos > 0 && <small> · 사진 {pickedPhotos}장</small>}
                </h4>
                <div className="pc-detail-list">
                  {info.records.map((r) => (
                    <p className="pc-rec" key={`r${r.id}`}>
                      <span className="pc-dot" aria-hidden="true" />
                      <b>{r.title}</b>
                      {r.place ? <span> · 📍 {r.place}</span> : null}
                    </p>
                  ))}
                  {info.items.map((it) => (
                    <p className="pc-item" key={it.key}>
                      <b>{it.label}</b>
                      <span>
                        {it.place ? ` · 📍 ${it.place}` : ""} · {it.count}장
                      </span>
                    </p>
                  ))}
                  {pickedPhotos === 0 && <p className="pc-none">이 날 올라온 사진은 없어요.</p>}
                </div>
              </div>
            </>
          ) : (
            <p className="pc-hint">날짜를 누르면 그날의 약속 기록과 사진 정보가 여기에 나와요.</p>
          )}
        </div>

        <div className="pc-foot">
          <span className="pc-legend">
            <span className="pc-dot" aria-hidden="true" /> 약속 기록
          </span>
          {selected && (
            <button
              type="button"
              className="btn secondary sm"
              onClick={() => {
                onSelect(null);
                onClose();
              }}
            >
              날짜 선택 해제
            </button>
          )}
          <button
            type="button"
            className="btn sm"
            disabled={!canOpen}
            onClick={() => {
              onSelect(picked);
              onClose();
            }}
          >
            {pickedPhotos > 0 ? `이 날 사진 보기 (${pickedPhotos}장)` : canOpen ? "이 날 보기" : "이 날 사진 보기"}
          </button>
        </div>
      </div>
    </div>
  );
}
