// 첫 만남일("YYYY-MM-DD")로 D-day 문구를 만든다. 첫 만남일 당일이 1일째.
export function ddayLabel(startedOn: string | null): string | null {
  if (!startedOn) return null;
  const [y, m, d] = startedOn.split("-").map(Number);
  if (!y || !m || !d) return null;
  const start = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.getTime() - start.getTime()) / 86400000);
  if (diff >= 0) return `함께한 지 ${diff + 1}일째`;
  return `첫 만남까지 D-${-diff}`;
}
