/**
 * #395 (M15-3): 기간 비교 표. 순수 — 두 구간의 롤업 값 → A | B | B − A 행.
 *
 * - KPI 7종 (#394 와 같은 정의: 평균 페이스 = 시간 합 / 거리 합, 체중 = 기간 말 값) + 선택 지표가 거기 없으면 1행 추가.
 * - 차이에는 좋고 나쁨을 싣지 않는다 (지표마다 방향이 다르다). 부호 + 크기만.
 * - 구간 길이가 다르거나 한쪽이 잘린 구간이면 합계형에 월평균을 병기한다 — 5개월 vs 3개월 합계는 비교가 안 된다.
 */
import { formatPace } from "@/lib/format";
import { formatHistoryValue, historyDisplayUnit } from "./format";
import { averagePaceSecPerKm, HISTORY_KPI_METRIC_IDS, type HistoryBucketValues } from "./kpi";
import { getHistoryMetric, type HistoryMetricId } from "./metrics";

export interface CompareCell {
  /** null = 기록 없음 */
  text: string | null;
  /** 합계형 · 구간 길이가 다를 때만 */
  perMonthText: string | null;
}

export interface CompareRow {
  key: string;
  label: string;
  unit: string;
  selected: boolean;
  a: CompareCell;
  b: CompareCell;
  /** `+12.3` · `−4` · `0` (단위 없음 — 행 제목의 단위를 따른다. 페이스만 `+50초`). null = 한쪽이 기록 없음 */
  diffText: string | null;
}

export interface ComparePeriod {
  values: HistoryBucketValues;
  /** 명목 월 수 (구간 길이 비교 · 표기) */
  months: number;
  /** 실제 조회 일수 — 이번 달이 들어가면 오늘까지만이라 명목 월 수로 나누면 월평균이 과소 계산된다 */
  totalDays: number;
  /** 하한 · 오늘에 잘려 달력 월 전체를 덮지 못하는 구간 */
  truncated: boolean;
}

/**
 * 합계를 그대로 비교하면 안 되는가. 명목 월 수가 다르거나, 같아도 한쪽이 잘린 구간이면 (7~9월 2025 = 92일 vs
 * 7~9월 2026 오늘까지 = 83일) 월평균을 병기한다 (PR #407 Codex P2). 2월 vs 3월 같은 자연스러운 일수 차이는 대상이 아니다.
 */
export function needsPerMonth(a: ComparePeriod, b: ComparePeriod): boolean {
  return a.months !== b.months || a.truncated || b.truncated;
}

const DAYS_PER_MONTH = 365.25 / 12;

interface RowSpec {
  key: string;
  label: string;
  metricId: HistoryMetricId | null;
  pick: (values: HistoryBucketValues) => number | null;
}

const MINUS = "−";

const KPI_ROWS: readonly RowSpec[] = [
  { key: "runningKm", label: "총 거리", metricId: "runningKm", pick: (v) => v.runningKm?.value ?? null },
  { key: "runningCount", label: "러닝", metricId: "runningCount", pick: (v) => v.runningCount?.value ?? null },
  { key: "pace", label: "평균 페이스", metricId: null, pick: (v) => averagePaceSecPerKm(v.runningDurationSec?.value, v.runningKm?.value) },
  { key: "vo2max", label: "최고 VO2max", metricId: "vo2max", pick: (v) => v.vo2max?.value ?? null },
  { key: "restingHR", label: "평균 안정시 심박", metricId: "restingHR", pick: (v) => v.restingHR?.value ?? null },
  { key: "sleepScore", label: "평균 수면 점수", metricId: "sleepScore", pick: (v) => v.sleepScore?.value ?? null },
  { key: "weight", label: "기간 말 체중", metricId: "weight", pick: (v) => v.weight?.last ?? null },
];

/** 비교 뷰가 조회해야 하는 지표 (KPI 재료 + 선택 지표). */
export function compareMetricIds(selected: HistoryMetricId): HistoryMetricId[] {
  return [...new Set<HistoryMetricId>([...HISTORY_KPI_METRIC_IDS, selected])];
}

function signed(diff: number, magnitude: string): string {
  if (diff === 0) return magnitude;
  return `${diff > 0 ? "+" : MINUS}${magnitude}`;
}

function buildRow(spec: RowSpec, a: ComparePeriod, b: ComparePeriod, selected: boolean): CompareRow {
  const def = spec.metricId ? getHistoryMetric(spec.metricId) : null;
  const isPace = def === null || def.format === "pace";
  const format = (n: number) => (def && !isPace ? formatHistoryValue(def, n) : formatPace(n));
  const showPerMonth = def !== null && def.aggregate === "sum" && needsPerMonth(a, b);

  const cell = (period: ComparePeriod): CompareCell => {
    const value = spec.pick(period.values);
    if (value === null) return { text: null, perMonthText: null };
    return {
      text: format(value),
      perMonthText:
        showPerMonth && def && period.totalDays > 0 ? formatHistoryValue(def, value / (period.totalDays / DAYS_PER_MONTH)) : null,
    };
  };

  const av = spec.pick(a.values);
  const bv = spec.pick(b.values);
  const diff = av === null || bv === null ? null : bv - av;
  const diffText =
    diff === null
      ? null
      : def === null || isPace
        ? signed(Math.round(diff), `${Math.abs(Math.round(diff))}초`)
        : signed(Number(diff.toFixed(def.decimals)), formatHistoryValue(def, Math.abs(diff)));

  return {
    key: spec.key,
    label: spec.label,
    unit: def ? historyDisplayUnit(def) : "/km",
    selected,
    a: cell(a),
    b: cell(b),
    diffText,
  };
}

export function buildCompareRows(a: ComparePeriod, b: ComparePeriod, selected: HistoryMetricId): CompareRow[] {
  const hasSelected = KPI_ROWS.some((r) => r.metricId === selected);
  const def = getHistoryMetric(selected);
  const extra: RowSpec[] = hasSelected
    ? []
    : [{ key: selected, label: def.label, metricId: selected, pick: (v) => v[selected]?.value ?? null }];
  return [...KPI_ROWS, ...extra].map((spec) => buildRow(spec, a, b, spec.metricId === selected));
}
