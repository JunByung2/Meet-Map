"use client";

import { useEffect, useRef, useState } from "react";
import { closePhotoViewer, discardPhotoViewer, setViewerIndex, usePhotoViewer } from "./photoViewerStore";
import css from "./photoViewer.module.css";

async function toPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d")?.drawImage(bmp, 0, 0);
  bmp.close?.();
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png"))), "image/png"));
}

/** 카톡처럼 떠 있는 사진 팝업 창 (채팅 화면에 한 번만 둔다). 제목줄을 끌어서 옮길 수 있다. */
export default function PhotoViewerWindow() {
  const v = usePhotoViewer();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [noteAt, setNoteAt] = useState<{ photo: number; index: number; text: string } | null>(null);
  const winRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    if (!v.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePhotoViewer();
      else if (e.key === "ArrowLeft") setViewerIndex(v.index - 1);
      else if (e.key === "ArrowRight") setViewerIndex(v.index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [v.open, v.index]);

  useEffect(() => () => discardPhotoViewer(), []); // 채팅 화면을 떠나면 닫는다

  useEffect(() => {
    // 지금 사진의 작은 그림이 보이도록 아래 띠를 맞춘다
    const el = stripRef.current?.querySelector<HTMLElement>('[data-on="1"]');
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [v.index, v.open]);

  if (!v.open) return null;
  const cur = v.photos[v.index];
  const api = `/api/groups/${v.groupId}/chat-files/${cur.id}/download`;

  function download() {
    const a = document.createElement("a");
    a.href = api;
    a.download = cur.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function copy() {
    try {
      // 클릭 직후에 클립보드를 잡아 두고, 사진 내용은 나중에 채운다 (브라우저가 허용하는 방식)
      const png = fetch(api, { credentials: "same-origin" })
        .then((r) => {
          if (!r.ok) throw new Error("fetch");
          return r.blob();
        })
        .then(toPngBlob);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setNoteAt({ photo: cur.id, index: v.index, text: "사진을 복사했어요" });
    } catch {
      setNoteAt({ photo: cur.id, index: v.index, text: "복사하지 못했어요 (브라우저가 허용하지 않을 수 있어요)" });
    }
  }

  function onDown(e: React.PointerEvent) {
    const rect = winRef.current?.getBoundingClientRect();
    if (!rect || (e.target as HTMLElement).closest("button")) return;
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const w = winRef.current?.offsetWidth ?? 0;
    setPos({
      x: Math.min(Math.max(e.clientX - drag.current.dx, 8 - w + 120), window.innerWidth - 120),
      y: Math.min(Math.max(e.clientY - drag.current.dy, 0), window.innerHeight - 48),
    });
  }
  function onUp() {
    drag.current = null;
  }

  return (
    <div
      ref={winRef}
      className={css.win}
      style={pos ? { left: pos.x, top: pos.y, transform: "none" } : undefined}
      role="dialog"
      aria-label="사진 보기"
    >
      <div className={css.bar} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <span className={css.title}>{v.title}</span>
        <button type="button" className={css.x} onClick={closePhotoViewer} aria-label="닫기">
          ×
        </button>
      </div>
      <div className={css.stage}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cur.url} alt={cur.name} />
        {v.photos.length > 1 && (
          <>
            <button type="button" className={`${css.nav} ${css.prev}`} aria-label="이전 사진" onClick={() => setViewerIndex(v.index - 1)}>
              ‹
            </button>
            <button type="button" className={`${css.nav} ${css.next}`} aria-label="다음 사진" onClick={() => setViewerIndex(v.index + 1)}>
              ›
            </button>
            <span className={css.pill}>
              {v.index + 1}/{v.photos.length}
            </span>
          </>
        )}
      </div>
      {v.photos.length > 1 && (
        <div className={css.strip} ref={stripRef}>
          {v.photos.map((p, i) => (
            <button
              type="button"
              key={p.id}
              data-on={i === v.index ? "1" : undefined}
              className={`${css.thumb}${i === v.index ? ` ${css.thumbOn}` : ""}`}
              onClick={() => setViewerIndex(i)}
              aria-label={`${i + 1}번 사진`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" />
            </button>
          ))}
        </div>
      )}
      <div className={css.tools}>
        <span className={css.note} role="status">
          {noteAt && noteAt.photo === cur.id ? noteAt.text : ""}
        </span>
        <button type="button" className={css.tool} onClick={() => void copy()}>
          ⧉ 복사
        </button>
        <button type="button" className={css.tool} onClick={download}>
          ⬇ 다운로드
        </button>
      </div>
    </div>
  );
}
