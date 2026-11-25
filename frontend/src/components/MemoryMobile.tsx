"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { MemoryMapPreview } from "@/features/memory/MemoryMap";
import { api, ApiError } from "@/lib/api";
import { groupLabel, type PhotoGroup } from "@/lib/photos";
import { formatMeetDate, type MeetingRecord } from "@/lib/records";
import { PAGE_SIZE as RECORD_PAGE_SIZE, pageCount as recordPageCount } from "@/components/Pager";
import "@/components/records.css";

type Tab = "photos" | "records" | "map";

const PAGE_SIZE = 6; // 한 페이지에 6장 (2열 x 3줄)

const pad = (n: number) => String(n);
/** 2025.10.9 (시안처럼 0 을 붙이지 않는다) */
function shortDate(iso: string) {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const TABS: { key: Tab; label: string; icon: ReactNode }[] = [
  {
    key: "photos",
    label: "사진",
    icon: (
      <Icon>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="1.6" />
        <path d="m21 15-4.5-4.5L6 21" />
      </Icon>
    ),
  },
  {
    key: "records",
    label: "기록",
    icon: (
      <Icon>
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
        <path d="M8.5 11h.01M12 11h.01M15.5 11h.01" />
      </Icon>
    ),
  },
  {
    key: "map",
    label: "추억 지도",
    icon: (
      <Icon>
        <path d="M9 4 3 6.5v13L9 17l6 3 6-2.5v-13L15 7 9 4Z" />
        <path d="M9 4v13M15 7v13" />
      </Icon>
    ),
  },
];

type Card = { key: string; href: string; img: string | null; title: string; meta: string; count: number };

/** 시안의 카드 한 장: 사진 · 제목 · 날짜 · 장소 */
function Cards({ cards, empty }: { cards: Card[]; empty: string }) {
  if (cards.length === 0) return <p className="mhm-empty">{empty}</p>;
  return (
    <div className="mhm-grid">
      {cards.map((c) => (
        <Link key={c.key} href={c.href} className="mhm-card">
          <span className={`mhm-img${c.img ? "" : " noimg"}`}>
            {c.img && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.img} alt="" loading="lazy" decoding="async" />
            )}
            {c.count > 1 && <b className="mhm-count">{c.count}</b>}
          </span>
          <strong>{c.title}</strong>
          <small>{c.meta}</small>
        </Link>
      ))}
    </div>
  );
}

/** ‹ 1 2 3 › */
function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <nav className="mhm-pager" aria-label="페이지 이동">
      <button type="button" disabled={page === 1} onClick={() => onPage(page - 1)} aria-label="이전 페이지">
        ‹
      </button>
      {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
        <button key={n} type="button" className={n === page ? "on" : undefined} aria-current={n === page ? "page" : undefined} onClick={() => onPage(n)}>
          {n}
        </button>
      ))}
      <button type="button" disabled={page === pages} onClick={() => onPage(page + 1)} aria-label="다음 페이지">
        ›
      </button>
    </nav>
  );
}

/**
 * 모바일(650px 이하) 전용 추억 화면 (피그마 시안): ARCHIVE 머리말 · 폴더 모양 탭(사진 / 기록 / 추억 지도) · 2열 카드 · 페이지 번호.
 * PC·태블릿에서는 CSS 로 통째로 숨겨지고, 기존 화면이 그대로 보인다.
 */
export default function MemoryMobile({
  groupId,
  groups,
  records,
  photosReady,
  error,
  onRecordRemoved,
}: {
  groupId: string;
  groups: PhotoGroup[];
  records: MeetingRecord[] | null;
  photosReady: boolean;
  error: string;
  onRecordRemoved: (id: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("photos");
  const [photoPage, setPhotoPage] = useState(1);
  const [recPage, setRecPage] = useState(1);
  const [recError, setRecError] = useState("");

  const photoCards: Card[] = groups.map((g) => ({
    key: g.key,
    href: `/groups/${groupId}/photos/${g.photos[0].id}`,
    img: g.photos.find((p) => p.signed_url)?.signed_url ?? null,
    title: groupLabel(g),
    meta: [shortDate(g.created_at), g.place?.name].filter(Boolean).join(" · "),
    count: g.photos.length,
  }));
  const totalPages = Math.max(1, Math.ceil(photoCards.length / PAGE_SIZE));
  const page = Math.min(photoPage, totalPages);
  const shown = photoCards.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const setPage = (p: number) => {
    setPhotoPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // 기록 탭은 PC 의 "지난 기록" 화면과 같은 목록(커버 사진 · 날짜 · 제목 · 장소 · 사진 수)을 보여 준다
  const recList = records ?? [];
  const recPages = recordPageCount(recList.length);
  const recPageNow = Math.min(recPage, recPages);
  const recShown = recList.slice((recPageNow - 1) * RECORD_PAGE_SIZE, recPageNow * RECORD_PAGE_SIZE);

  async function removeRecord(r: MeetingRecord) {
    if (!window.confirm(`'${r.title}' 기록을 삭제할까요?\n모든 팀원에게서 지워져요. 약속과 사진은 그대로 남아요.`)) return;
    setRecError("");
    try {
      await api(`/groups/${groupId}/records/${r.id}`, { method: "DELETE" });
      onRecordRemoved(r.id);
    } catch (e) {
      setRecError(e instanceof ApiError ? e.message : "삭제하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  }

  return (
    <div className="mhm">
      <header className="mhm-head">
        <div>
          <p>ARCHIVE</p>
          <h1>우리의 추억</h1>
        </div>
        <div className="mhm-actions">
          {tab === "photos" && (
            <Link href={`/groups/${groupId}/photos`} className="mhm-all" aria-label="사진 전체 보기">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="9" cy="9" r="1.8" />
                <path d="m21 15-4.5-4.5L6 21" />
              </svg>
              전체 보기
            </Link>
          )}
          <Link href={`/groups/${groupId}/photos/upload`} className="mhm-cam" aria-label="사진 올리기">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14.5 4h-5L8 6H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3l-1.5-2Z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </Link>
        </div>
      </header>

      <div className="mhm-tabs" role="tablist" aria-label="추억 보기">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : undefined} onClick={() => setTab(t.key)}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="mhm-body">
        {error && <div className="error">{error}</div>}
        {tab === "map" ? (
          <section className="mhm-map">
            <div className="mhm-maphead">
              <strong>함께 다녀온 곳</strong>
              <Link href={`/groups/${groupId}/map?view=memory`}>크게 보기 →</Link>
            </div>
            <MemoryMapPreview groupId={groupId} height="380px" />
          </section>
        ) : tab === "photos" && !photosReady ? (
          <div className="mhm-skel" aria-busy="true" />
        ) : tab === "records" ? (
          records === null ? (
            <div className="mhm-skel" aria-busy="true" />
          ) : recList.length === 0 ? (
            <p className="mhm-empty">약속이 확정되면 기록이 여기에 자동으로 생겨요.</p>
          ) : (
            <>
              {recError && <div className="error">{recError}</div>}
              <div className="rc-list">
                {recShown.map((r) => (
                  <div className="rc-wrap" key={r.id}>
                    <Link className="rc-card" href={`/groups/${groupId}/records/${r.id}`}>
                      <div className="rc-cover">
                        {r.cover_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.cover_url} alt={`${r.title} 대표 사진`} loading="lazy" decoding="async" />
                        ) : (
                          <span>사진 없는 기록</span>
                        )}
                      </div>
                      <div className="rc-body">
                        <span className="rc-date">{formatMeetDate(r.meet_date)}</span>
                        <span className="rc-title">{r.title}</span>
                        <span className="rc-line">📍 {r.place_name ?? "장소를 정하지 않았어요"}</span>
                        {r.photo_count > 0 && (
                          <div className="rc-chips">
                            <span className="rc-chip">사진 {r.photo_count}장</span>
                          </div>
                        )}
                      </div>
                    </Link>
                    {r.can_edit && (
                      <button type="button" className="rc-del" onClick={() => void removeRecord(r)}>
                        삭제
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <Pager page={recPageNow} pages={recPages} onPage={(p) => { setRecPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
            </>
          )
        ) : (
          <>
            <Cards cards={shown} empty="아직 올린 사진이 없어요." />
            <Pager page={page} pages={totalPages} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
