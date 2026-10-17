// 사진 기능 공통 도우미 (타입 / 묶음 / 날짜 / 업로드 제한)

export type Photo = {
  id: number;
  group_id: number;
  user_id: number | null;
  uploader_nickname: string | null;
  storage_path: string;
  url: string | null;
  caption: string | null;
  title: string | null;
  memo: string | null;
  batch_id: string;
  sort_order: number;
  place_id: string | null;
  place_name: string | null;
  place_address: string | null;
  place_lat: number | null;
  place_lng: number | null;
  created_at: string;
  signed_url: string | null;
  can_edit: boolean;
};

/** 사진을 찍은 장소 (카카오 장소 검색 결과) */
export type PlaceValue = {
  id: string | null;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
};

export function placeOf(p: Photo): PlaceValue | null {
  if (!p.place_name || p.place_lat == null || p.place_lng == null) return null;
  return { id: p.place_id, name: p.place_name, address: p.place_address, lat: p.place_lat, lng: p.place_lng };
}

export type PhotoDetail = { photo: Photo; batch: Photo[] };

/** 한 번에 올린 사진 묶음 (batch_id 가 같은 사진들) */
export type PhotoGroup = {
  key: string;
  photos: Photo[];
  title: string | null;
  memo: string | null;
  created_at: string;
  uploader: string | null;
  can_edit: boolean;
  place: PlaceValue | null;
};

// 서버(backend/app/config.py)와 같은 제한. 서버도 똑같이 다시 검사한다.
export const MAX_FILES = 20;
export const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = ["jpg", "jpeg", "png", "webp", "heic"];

export function hasAllowedExtension(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ALLOWED.includes(ext);
}

/** 최신순으로 받은 사진을 batch_id 기준으로 묶고, 묶음 안에서는 올린 순서(sort_order)대로 정렬 */
export function groupPhotos(photos: Photo[]): PhotoGroup[] {
  const map = new Map<string, Photo[]>();
  for (const p of photos) {
    const list = map.get(p.batch_id);
    if (list) list.push(p);
    else map.set(p.batch_id, [p]);
  }
  return Array.from(map.entries()).map(([key, list]) => {
    const sorted = [...list].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    return {
      key,
      photos: sorted,
      title: sorted.find((p) => p.title?.trim())?.title ?? null,
      memo: sorted.find((p) => p.memo?.trim())?.memo ?? null,
      created_at: sorted[0].created_at,
      uploader: sorted[0].uploader_nickname,
      can_edit: sorted.every((p) => p.can_edit),
      place: sorted.map(placeOf).find((x) => x !== null) ?? null,
    };
  });
}

export function groupLabel(g: PhotoGroup) {
  return g.title?.trim() || g.photos.find((p) => p.caption?.trim())?.caption?.trim() || "이 순간을 기억해요";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 2026.09.27 */
export function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

/** 2026.09.27 오후 6:12 */
export function formatDateTime(iso: string) {
  const d = new Date(iso);
  const h = d.getHours();
  return `${formatDate(iso)} ${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}:${pad(d.getMinutes())}`;
}
