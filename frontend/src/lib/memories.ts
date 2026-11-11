// 그룹에 들어가기 전 "전체 추억" 화면에서 쓰는 타입과 그룹 색깔

export type MemGroup = { id: number; name: string; icon: string | null };

export type MemPhoto = {
  id: number;
  group_id: number;
  batch_id: string;
  title: string | null;
  created_at: string;
  signed_url: string | null;
  place_id: string | null;
  place_name: string | null;
  place_address: string | null;
  place_lat: number | null;
  place_lng: number | null;
};

export type MemRecord = {
  id: number;
  group_id: number;
  title: string;
  meet_date: string;
  place_name: string | null;
  photo_count: number;
  cover_url: string | null;
};

export type Memories = {
  groups: MemGroup[];
  photos: MemPhoto[];
  place_photos: MemPhoto[];
  records: MemRecord[];
};

// 구분이 잘 되는 10가지 색 (노랑 · 빨강 · 청록 · 파랑 · 보라 · 분홍 · 초록 · 주황 · 회청 · 갈색)
export const GROUP_COLORS = [
  "#F2B705",
  "#E5484D",
  "#2F9E8F",
  "#4C6FFF",
  "#9B5DE5",
  "#F27BB0",
  "#3FA34D",
  "#F2711C",
  "#6B7F99",
  "#8D5A3B",
];

/**
 * 그룹마다 색을 하나씩 정한다. 그룹 번호 순서대로 색을 나눠 주기 때문에
 * 같은 사람이 보면 언제나 같은 그룹이 같은 색이다.
 */
export function colorMap(groups: { id: number }[]): Map<number, string> {
  const ids = groups.map((g) => g.id).sort((a, b) => a - b);
  return new Map(ids.map((id, i) => [id, GROUP_COLORS[i % GROUP_COLORS.length]]));
}
