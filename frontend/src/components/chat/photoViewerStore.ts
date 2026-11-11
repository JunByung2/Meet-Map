"use client";

import { useSyncExternalStore } from "react";

// 사진 보기 팝업은 화면에 하나만 있다. 다른 사진을 누르면 새 창이 뜨는 게 아니라 그 창의 사진이 바뀐다.
export type ViewerPhoto = { id: number; name: string; url: string };
type State = { open: boolean; photos: ViewerPhoto[]; index: number; title: string; groupId: number };

const CLOSED: State = { open: false, photos: [], index: 0, title: "", groupId: 0 };
let state: State = CLOSED;
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

// 폰의 뒤로가기를 눌렀을 때 채팅방을 떠나지 않고 사진 창만 닫히게, 열 때 기록 한 칸을 쌓아 둔다.
let pushed = false;
function onPop() {
  // 뒤로가기로 우리가 쌓은 칸이 지워졌다 → 사진 창만 닫는다
  pushed = false;
  window.removeEventListener("popstate", onPop);
  if (state.open) set(CLOSED);
}
function pushEntry() {
  if (pushed || typeof window === "undefined") return;
  // Next.js 가 쓰는 history.state 를 그대로 이어 받아야 라우터가 헷갈리지 않는다
  window.history.pushState({ ...(window.history.state ?? {}), photoViewer: 1 }, "", window.location.href);
  pushed = true;
  window.addEventListener("popstate", onPop);
}

export function openPhotoViewer(photos: ViewerPhoto[], index: number, title: string, groupId: number) {
  if (photos.length === 0) return;
  if (!state.open) pushEntry();
  set({ open: true, photos, index: Math.min(Math.max(index, 0), photos.length - 1), title, groupId });
}
/** 화면의 ✕ 나 Esc 로 닫을 때: 쌓아 둔 기록 칸도 함께 되돌린다 */
export function closePhotoViewer() {
  if (!state.open) return;
  set(CLOSED);
  if (pushed) {
    pushed = false;
    window.removeEventListener("popstate", onPop);
    window.history.back();
  }
}
/** 채팅 화면을 떠날 때: 이미 다른 화면으로 가는 중이므로 history 는 건드리지 않는다 */
export function discardPhotoViewer() {
  if (pushed) {
    pushed = false;
    window.removeEventListener("popstate", onPop);
  }
  if (state.open) set(CLOSED);
}
export function setViewerIndex(index: number) {
  if (!state.open) return;
  const n = state.photos.length;
  set({ ...state, index: ((index % n) + n) % n });
}

export function usePhotoViewer(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => CLOSED,
  );
}
