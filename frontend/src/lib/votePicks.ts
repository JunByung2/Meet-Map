import type { PlaceValue } from "@/lib/photos";

// 약속장소 추천 화면에서 담은 투표 후보를 채팅 화면으로 넘기는 임시 저장소 (탭 안에서만, 10분 동안만 유효)
const MAX_PLACES = 6;
const TTL_MS = 10 * 60 * 1000;
const storageKey = (groupId: number | string) =>
  `meetmap:vote-picks:${groupId}`;

export function saveVotePicks(groupId: number | string, places: PlaceValue[]) {
  try {
    sessionStorage.setItem(
      storageKey(groupId),
      JSON.stringify({
        savedAt: Date.now(),
        places: places.slice(0, MAX_PLACES),
      }),
    );
  } catch {
    /* 저장이 막혀 있으면 넘기지 못할 뿐, 투표 창은 빈 채로 열린다 */
  }
}

/** 저장된 후보를 한 번만 꺼낸다. 값은 믿지 않고 모양·범위를 다시 검사한다. */
export function takeVotePicks(groupId: number | string): PlaceValue[] {
  try {
    const key = storageKey(groupId);
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    sessionStorage.removeItem(key);
    const data = JSON.parse(raw);
    if (
      !data ||
      typeof data.savedAt !== "number" ||
      Date.now() - data.savedAt > TTL_MS
    )
      return [];
    if (!Array.isArray(data.places)) return [];
    const out: PlaceValue[] = [];
    for (const p of data.places.slice(0, MAX_PLACES)) {
      if (
        !p ||
        typeof p.name !== "string" ||
        !p.name.trim() ||
        p.name.length > 200
      )
        continue;
      const { lat, lng } = p;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      )
        continue;
      out.push({
        id: typeof p.id === "string" && p.id.length <= 40 ? p.id : null,
        name: p.name.trim(),
        address: typeof p.address === "string" ? p.address.slice(0, 200) : null,
        lat,
        lng,
      });
    }
    return out;
  } catch {
    return [];
  }
}
