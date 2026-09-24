// #455: 보폭 단위 정규화 — 스키마는 m (#278 파서가 Garmin cm ÷ 100) 이지만 파서 정정 이전 행은 cm 그대로 남아 있다 (로컬 실측 78.87 · 83.56).
// 사람 보폭이 10m 를 넘지 않으므로 10 이상이면 cm 로 본다. 활동 평가 (#440) 와 MCP runningSummary 가 같은 규칙을 쓴다.
export const STRIDE_CM_THRESHOLD = 10;

export function strideMeters(v: number): number {
  return v >= STRIDE_CM_THRESHOLD ? v / 100 : v;
}

export function strideCm(v: number): number {
  return Math.round(strideMeters(v) * 100);
}
