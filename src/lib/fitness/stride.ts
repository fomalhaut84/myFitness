// #455: 보폭 단위 정규화 — 스키마는 m (#278 파서가 Garmin cm ÷ 100) 이지만 파서 정정 이전 행은 cm 그대로 남아 있다 (로컬 실측 78.87 · 83.56).
// 사람 보폭이 10m 를 넘지 않으므로 10 이상이면 cm 로 본다. 활동 평가 (#440) 와 MCP runningSummary 가 같은 규칙을 쓴다.
export const STRIDE_CM_THRESHOLD = 10;

export function strideMeters(v: number): number {
  return v >= STRIDE_CM_THRESHOLD ? v / 100 : v;
}

/** 표시용 cm — 원식 그대로 (`/100 * 100` 은 .5 경계에서 부동소수 오차로 1cm 어긋난다 — 사전 리뷰 info 1) */
export function strideCm(v: number): number {
  return Math.round(v >= STRIDE_CM_THRESHOLD ? v : v * 100);
}
