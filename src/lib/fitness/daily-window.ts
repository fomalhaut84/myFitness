// #455 F3: 일별 창 합계 — 강도 분 (WHO 권고 주 150분 · Garmin 은 고강도 2배 가중) · 층수. 순수. null 은 0 이 아니라 "측정 없음" 이라 제외.

export interface DailyWindowRow {
  intensityMin: number | null;
  floorsClimbed: number | null;
}

export interface DailyWindowTotals {
  days: number;
  /** 값 있는 날의 합 — 하루도 없으면 null */
  intensityMinTotal: number | null;
  daysWithIntensity: number;
  floorsClimbedTotal: number | null;
}

function sumPresent(values: readonly (number | null)[]): { total: number | null; n: number } {
  const present = values.flatMap((v) => (v === null ? [] : [v]));
  return { total: present.length > 0 ? present.reduce((s, v) => s + v, 0) : null, n: present.length };
}

export function summarizeDailyWindow(rows: readonly DailyWindowRow[]): DailyWindowTotals {
  const intensity = sumPresent(rows.map((r) => r.intensityMin));
  const floors = sumPresent(rows.map((r) => r.floorsClimbed));
  return { days: rows.length, intensityMinTotal: intensity.total, daysWithIntensity: intensity.n, floorsClimbedTotal: floors.total };
}
