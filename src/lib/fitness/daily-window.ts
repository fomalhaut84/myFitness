// #455 F3: 일별 창 합계 — 강도 분 · 층수. 순수. null 은 0 이 아니라 "측정 없음" 이라 제외.
// 회귀: PR #462 Codex P1 — `DailySummary.intensityMin` 은 moderate + vigorous 단순합 (daily-summary.ts · endpoint audit A10) 인데
// WHO 150분 · Garmin 주간 목표는 vigorous ×2 가중. 단순합을 150 과 비교하면 권고 미달을 잘못 말한다 → rawData 의 두 성분으로 가중 합을 따로 낸다.

export interface DailyWindowRow {
  intensityMin: number | null;
  floorsClimbed: number | null;
  /** Garmin 일별 요약 원본 (`moderateIntensityMinutes` · `vigorousIntensityMinutes`) — 없으면 가중 합을 낼 수 없다 */
  rawData?: unknown;
}

export interface IntensityComponents {
  moderate: number;
  vigorous: number;
}

export interface DailyWindowTotals {
  /** 창 안 DailySummary 행 수 (요청 days 와 다르다 — 사전 리뷰 info 4) */
  rowCount: number;
  /** 저장 컬럼 (moderate + vigorous 단순합) 의 합 — 하루도 없으면 null */
  intensityMinTotal: number | null;
  daysWithIntensity: number;
  /** moderate + 2 × vigorous — WHO 150분 · Garmin 주간 목표와 같은 가중. 성분이 있는 날의 합, 하루도 없으면 null */
  weightedIntensityMinTotal: number | null;
  moderateMinTotal: number | null;
  vigorousMinTotal: number | null;
  /** 가중 합에 들어간 날 수 — daysWithIntensity 보다 작으면 성분 없는 날은 비가중 값만 있다 */
  daysWithComponents: number;
  floorsClimbedTotal: number | null;
}

const VIGOROUS_WEIGHT = 2;

function toInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** rawData 에서 중강도 · 고강도 분. 둘 다 없으면 null (한쪽만 있으면 없는 쪽은 0 — fetcher 와 같은 규칙) */
export function intensityComponents(rawData: unknown): IntensityComponents | null {
  if (!rawData || typeof rawData !== "object") return null;
  const raw = rawData as Record<string, unknown>;
  const moderate = toInt(raw.moderateIntensityMinutes);
  const vigorous = toInt(raw.vigorousIntensityMinutes);
  if (moderate === null && vigorous === null) return null;
  return { moderate: moderate ?? 0, vigorous: vigorous ?? 0 };
}

export function weightedIntensityMin(c: IntensityComponents): number {
  return c.moderate + VIGOROUS_WEIGHT * c.vigorous;
}

function sumPresent(values: readonly (number | null)[]): { total: number | null; n: number } {
  const present = values.flatMap((v) => (v === null ? [] : [v]));
  return { total: present.length > 0 ? present.reduce((s, v) => s + v, 0) : null, n: present.length };
}

export function summarizeDailyWindow(rows: readonly DailyWindowRow[]): DailyWindowTotals {
  const intensity = sumPresent(rows.map((r) => r.intensityMin));
  const components = rows.map((r) => intensityComponents(r.rawData));
  const weighted = sumPresent(components.map((c) => (c === null ? null : weightedIntensityMin(c))));
  const moderate = sumPresent(components.map((c) => c?.moderate ?? null));
  const vigorous = sumPresent(components.map((c) => c?.vigorous ?? null));
  const floors = sumPresent(rows.map((r) => r.floorsClimbed));
  return {
    rowCount: rows.length,
    intensityMinTotal: intensity.total,
    daysWithIntensity: intensity.n,
    weightedIntensityMinTotal: weighted.total,
    moderateMinTotal: moderate.total,
    vigorousMinTotal: vigorous.total,
    daysWithComponents: weighted.n,
    floorsClimbedTotal: floors.total,
  };
}
