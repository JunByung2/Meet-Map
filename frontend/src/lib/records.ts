// 약속 기록 기능 공통 타입 / 도우미
import type { Photo } from "@/lib/photos";

export type MeetingRecord = {
  id: number;
  group_id: number;
  title: string;
  meet_date: string; // YYYY-MM-DD
  meeting_id: number | null;
  place_id: string | null;
  place_name: string | null;
  place_address: string | null;
  place_lat: number | null;
  place_lng: number | null;
  note: string | null;
  created_by: number | null;
  creator_nickname: string | null;
  photo_count: number;
  cover_url: string | null;
  created_at: string;
  can_edit: boolean;
};

export type RecordDetail = { record: MeetingRecord; photos: Photo[] };

/** 2026-10-22 → 2026.10.22 (목) */
export function formatMeetDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const day = ["일", "월", "화", "수", "목", "금", "토"][new Date(y, m - 1, d).getDay()];
  return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")} (${day})`;
}

/** 2026-10-28 → 2026년 10월 28일 수요일 (카톡 날짜 띠 모양) */
export function formatDateBand(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const day = ["일", "월", "화", "수", "목", "금", "토"][new Date(y, m - 1, d).getDay()];
  return `${y}년 ${m}월 ${d}일 ${day}요일`;
}
