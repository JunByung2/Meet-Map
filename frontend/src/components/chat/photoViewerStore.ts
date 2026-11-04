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

export function openPhotoViewer(photos: ViewerPhoto[], index: number, title: string, groupId: number) {
  if (photos.length === 0) return;
  set({ open: true, photos, index: Math.min(Math.max(index, 0), photos.length - 1), title, groupId });
}
export function closePhotoViewer() {
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
