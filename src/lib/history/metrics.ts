/**
 * #393 (M15-1): 히스토리 지표 레지스트리. 지표별 소스 · 집계 규칙 · 결측 처리 · 단위를 한 곳에 둔다
 * (m15-overview D4). 페이지가 각자 reduce 하지 않는다. 지표 추가 = 이 배열에 항목 1건.
 *
 * prisma import 없음 — 클라이언트 컴포넌트(지표 선택기)도 참조할 수 있어야 한다. 필드명은
 * 생성된 Prisma 모델 타입의 키로 제한해 오타가 컴파일 타임에 잡히게 한다.
 */
import type {
  BodyComposition,
  DailySummary,
  FitnessMetricDaily,
  SleepRecord,
} from "@/generated/prisma/client";

export type HistoryAggregate = "sum" | "avg" | "max" | "last";

type NumericKey<T> = { [K in keyof T]: T[K] extends number | null ? K : never }[keyof T] & string;

export type HistoryMetricSource =
  | { source: "activity"; kind: "km" | "count" }
  | { source: "daily"; field: NumericKey<DailySummary> }
  | { source: "sleep"; field: NumericKey<SleepRecord> }
  | { source: "body"; field: NumericKey<BodyComposition> }
  | { source: "fitness"; field: NumericKey<FitnessMetricDaily> };

export type HistoryMetricDef = HistoryMetricSource & {
  id: HistoryMetricId;
  label: string;
  unit: string;
  /** 표시·반올림 소수 자리 */
  decimals: number;
  aggregate: HistoryAggregate;
  /** sum 형 활동 지표만 true — 활동 없음은 진짜 0. 그 외는 결측 = null ("기록 없음"). */
  missingAsZero: boolean;
  /** avg 형 중 min/max 밴드 제공 */
  withMinMax: boolean;
  /** 규칙과 별개로 기간 말 값(last)을 병기 (체중 · VO2max) */
  withLast: boolean;
};

export const HISTORY_METRIC_IDS = [
  "runningKm",
  "runningCount",
  "steps",
  "activeCalories",
  "sleepScore",
  "restingHR",
  "hrv",
  "stress",
  "weight",
  "vo2max",
  "ltPace",
] as const;
export type HistoryMetricId = (typeof HISTORY_METRIC_IDS)[number];

const base = { missingAsZero: false, withMinMax: false, withLast: false } as const;

export const HISTORY_METRICS: readonly HistoryMetricDef[] = [
  { ...base, id: "runningKm", label: "러닝 거리", unit: "km", decimals: 2, source: "activity", kind: "km", aggregate: "sum", missingAsZero: true },
  { ...base, id: "runningCount", label: "러닝 횟수", unit: "회", decimals: 0, source: "activity", kind: "count", aggregate: "sum", missingAsZero: true },
  { ...base, id: "steps", label: "걸음", unit: "보", decimals: 0, source: "daily", field: "steps", aggregate: "sum" },
  { ...base, id: "activeCalories", label: "활성 칼로리", unit: "kcal", decimals: 0, source: "daily", field: "activeCalories", aggregate: "sum" },
  { ...base, id: "sleepScore", label: "수면 점수", unit: "점", decimals: 0, source: "sleep", field: "sleepScore", aggregate: "avg", withMinMax: true },
  { ...base, id: "restingHR", label: "안정시 심박", unit: "bpm", decimals: 0, source: "daily", field: "restingHR", aggregate: "avg", withMinMax: true },
  { ...base, id: "hrv", label: "야간 HRV", unit: "ms", decimals: 1, source: "sleep", field: "hrvOvernight", aggregate: "avg" },
  { ...base, id: "stress", label: "평균 스트레스", unit: "", decimals: 0, source: "daily", field: "avgStress", aggregate: "avg" },
  { ...base, id: "weight", label: "체중", unit: "kg", decimals: 1, source: "body", field: "weight", aggregate: "avg", withMinMax: true, withLast: true },
  { ...base, id: "vo2max", label: "VO2max", unit: "", decimals: 1, source: "fitness", field: "vo2maxRunning", aggregate: "max", withLast: true },
  { ...base, id: "ltPace", label: "젖산역치 페이스", unit: "sec/km", decimals: 0, source: "fitness", field: "lthrPace", aggregate: "last" },
];

const byId: ReadonlyMap<HistoryMetricId, HistoryMetricDef> = new Map(HISTORY_METRICS.map((m) => [m.id, m]));

export function isHistoryMetricId(value: unknown): value is HistoryMetricId {
  return typeof value === "string" && byId.has(value as HistoryMetricId);
}

export function getHistoryMetric(id: HistoryMetricId): HistoryMetricDef {
  const def = byId.get(id);
  if (!def) throw new Error(`미등록 히스토리 지표: ${String(id)}`);
  return def;
}
