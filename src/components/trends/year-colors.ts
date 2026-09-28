// #395 YoY 규칙 — 올해만 지표색, 과거는 회색 사다리 (최근일수록 밝게). #397 `/insights` 산점도가 같이 쓴다.
export const PAST_GRAYS = ["#3a3a3a", "#4a4a4a", "#5c5c5c", "#737373", "#8f8f8f", "#b0b0b0"] as const;

export function yearColor(year: number, years: readonly number[], currentYear: number, color: string): string {
  if (year === currentYear) return color;
  const past = years.filter((y) => y !== currentYear);
  const rank = past.indexOf(year); // 0 = 가장 오래된 해
  const offset = PAST_GRAYS.length - past.length;
  return PAST_GRAYS[Math.max(0, Math.min(PAST_GRAYS.length - 1, rank + offset))];
}
