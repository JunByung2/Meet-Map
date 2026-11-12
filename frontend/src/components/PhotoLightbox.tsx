"use client";

import { useEffect } from "react";
import Link from "next/link";
import "./memories.css";

export type LightboxPhoto = { id: number; url: string | null; href: string };

/** 지도 · 전체 추억에서 쓰는 "사진 크게 보기". 뒤로 버튼 / 바깥 클릭 / Esc 로 닫고, 좌우로 넘겨 볼 수 있다. */
export default function PhotoLightbox({
  photos,
  index,
  onIndex,
  onClose,
}: {
  photos: LightboxPhoto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const n = photos.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onIndex((index + 1) % n);
      else if (e.key === "ArrowLeft") onIndex((index - 1 + n) % n);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, n, onIndex, onClose]);

  const cur = photos[index];
  if (!cur) return null;
  return (
    <div className="am-viewer" role="dialog" aria-modal="true" aria-label="사진 크게 보기" onClick={onClose}>
      <div className="am-viewer-bar" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose}>← 뒤로</button>
        <span>{index + 1} / {n}</span>
        <Link href={cur.href}>자세히 보기</Link>
      </div>
      {cur.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cur.url} alt="" onClick={(e) => e.stopPropagation()} />
      )}
      {n > 1 && (
        <>
          <button type="button" className="am-viewer-nav prev" aria-label="이전 사진" onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + n) % n); }}>‹</button>
          <button type="button" className="am-viewer-nav next" aria-label="다음 사진" onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % n); }}>›</button>
        </>
      )}
    </div>
  );
}
