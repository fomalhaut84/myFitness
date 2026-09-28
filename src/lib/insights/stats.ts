// #397: 작은 통계 유틸 — 라이브러리 추가 없음. 중앙값 · 평균 · 피어슨 r.

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 피어슨 상관계수. n < 3 또는 분산 0 이면 null (계산 불가를 0 으로 내지 않는다). */
export function pearson(pairs: readonly { x: number; y: number }[]): number | null {
  const n = pairs.length;
  if (n < 3) return null;
  const mx = pairs.reduce((s, p) => s + p.x, 0) / n;
  const my = pairs.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of pairs) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export type CorrelationWord = "관계 없음" | "약한 관계" | "관계 있음";

/** 통계 검정이 아니라 방향과 크기의 감각 — 0.1 미만 · 0.3 이상 경계 (스펙 F15). */
export function correlationWord(r: number | null): CorrelationWord | null {
  if (r === null) return null;
  const a = Math.abs(r);
  if (a < 0.1) return "관계 없음";
  if (a < 0.3) return "약한 관계";
  return "관계 있음";
}
