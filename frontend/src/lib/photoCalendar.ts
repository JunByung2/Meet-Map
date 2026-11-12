import type { DayCell } from "@/components/PhotoCalendar";
import type { MeetingRecord } from "@/lib/records";
import { coverPhotoOf, kstDay, type DayCover, type PhotoGroup } from "@/lib/photos";

/** 날짜(YYYY-MM-DD) -> 그날의 약속 기록들 */
export function recordsByDayOf(records: MeetingRecord[]): Map<string, MeetingRecord[]> {
  const map = new Map<string, MeetingRecord[]>();
  for (const r of records) {
    const list = map.get(r.meet_date);
    if (list) list.push(r);
    else map.set(r.meet_date, [r]);
  }
  return map;
}

/**
 * 달력에 보여 줄 날짜별 정보: 사진 장수, 대표 사진, 약속 기록 여부.
 * 사진 페이지의 달력 시트와 추억 화면의 "지난 기록" 달력이 같이 쓴다.
 */
export function buildCalendarDays(
  groups: PhotoGroup[],
  covers: DayCover[],
  recordsByDay: Map<string, MeetingRecord[]>,
): Map<string, DayCell> {
  // 달력 정보 칸에는 제목이나 장소가 있는 사진 묶음만 보여 준다. ("채팅 사진 · 1장" 처럼 똑같은 줄이 반복되는 것은 뺀다)
  // 같은 제목·장소의 묶음은 한 줄로 합치고 장수를 더한다.
  const infoItems = (list: PhotoGroup[]) => {
    const merged = new Map<string, { key: string; label: string; place: string | null; count: number }>();
    for (const g of list) {
      const title = g.title?.trim() || "";
      const place = g.place?.name ?? null;
      if ((!title || title === "채팅 사진") && !place) continue;
      const label = title && title !== "채팅 사진" ? title : "사진";
      const key = `${label}|${place ?? ""}`;
      const cur = merged.get(key);
      if (cur) cur.count += g.photos.length;
      else merged.set(key, { key, label, place, count: g.photos.length });
    }
    return Array.from(merged.values());
  };
  const infoOfRecords = (day: string) =>
    (recordsByDay.get(day) ?? []).map((r) => ({ id: r.id, title: r.title, place: r.place_name }));
  const byDay = new Map<string, PhotoGroup[]>();
  for (const g of groups) {
    const day = kstDay(g.created_at);
    const list = byDay.get(day);
    if (list) list.push(g);
    else byDay.set(day, [g]);
  }
  const coverIdOf = new Map(covers.map((c) => [c.day, c.photo_id]));
  const map = new Map<string, DayCell>();
  for (const [day, list] of byDay) {
    const cover = coverPhotoOf(list, coverIdOf.get(day));
    map.set(day, {
      count: list.reduce((n, g) => n + g.photos.length, 0),
      coverUrl: cover?.signed_url ?? cover?.url ?? null,
      hasRecord: recordsByDay.has(day),
      records: infoOfRecords(day),
      items: infoItems(list),
    });
  }
  for (const day of recordsByDay.keys()) {
    if (!map.has(day)) map.set(day, { count: 0, coverUrl: null, hasRecord: true, records: infoOfRecords(day), items: [] });
  }
  return map;
}
