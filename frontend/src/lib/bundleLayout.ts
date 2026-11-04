// 묶음 사진을 한 말풍선에 배치하는 규칙 (카톡처럼 알아서 정렬)
// - 한 줄에는 최대 4장. 3장 이하는 한 줄, 4장은 2x2.
// - 그 밖에는 줄 수를 최소로 하고 줄마다 장수를 고르게 나눈다 (많은 줄이 위로).
//   2→[2]  3→[3]  4→[2,2]  5→[3,2]  6→[3,3]  7→[4,3]  8→[4,4]  9→[3,3,3]  10→[4,3,3]  …  16→[4,4,4,4]
export const MAX_PER_ROW = 4;

export function rowsOf(n: number): number[] {
  if (n <= 0) return [];
  if (n <= 3) return [n];
  if (n === 4) return [2, 2];
  const rows = Math.ceil(n / MAX_PER_ROW);
  const base = Math.floor(n / rows);
  const extra = n % rows;
  return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0));
}

/** 말풍선 너비(px): 가장 많이 들어간 줄에 맞춘다 */
export function bubbleWidth(rows: number[]): number {
  const widest = Math.max(1, ...rows);
  return widest >= 4 ? 340 : widest === 3 ? 300 : 244;
}

/** 칸 목록을 줄별로 자른다 */
export function splitRows<T>(items: T[], rows: number[]): T[][] {
  const out: T[][] = [];
  let at = 0;
  for (const n of rows) {
    out.push(items.slice(at, at + n));
    at += n;
  }
  return out;
}
