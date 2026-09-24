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

/** #442: `median` — 활동 단위 값 (2분 HRR) 을 버킷으로 묶을 때 인터벌 · 레이스의 큰 값이 평균을 끌어올리지 않게 */
export type HistoryAggregate = "sum" | "avg" | "max" | "last" | "median";

type NumericKey<T> = { [K in keyof T]: T[K] extends number | null ? K : never }[keyof T] & string;

export type HistoryMetricSource =
  | { source: "activity"; kind: "km" | "count" | "duration" | "hrr2" }
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
  /**
   * #395: 원래 드물게 측정되는 값 (체중 — 6년 372건 · 젖산역치 페이스 — Garmin 감지일에만). 버킷의 기록 일수가 적은 것이
   * 정상이라 `/trends` 의 "기록 절반 미만" 흐림 · 제외 규칙을 적용하지 않는다.
   */
  sparse: boolean;
  /** #394: 표시 형식. "pace" 는 값이 sec/km — `formatPace` (`5'21"`) 로 그린다. API 응답의 `unit` · 값은 그대로 초. */
  format: "number" | "pace";
  /** #394: `/history` 지표 선택기 노출 여부. false 는 KPI 계산 전용 (러닝 시간 합 → 평균 페이스). */
  selectable: boolean;
  /**
   * #442: 데이터 시작일 캡션 (`{from}` 이 `YYYY-MM` 으로 치환). 기록 하한보다 훨씬 늦게 시작하는 지표 (2분 HRR 은 프로덕션
   * 2026-04 부터 — Garmin 보존 창 · #431) 에만. 시작일은 `data-start.ts` 가 데이터에서 읽는다.
   */
  startNote?: string;
  /**
   * #442 (PR #447 Codex P2): 활동 지표의 커버리지 문구 명사. 기본 "달림" (러닝한 날) — 값이 있는 활동만 점을 내는 지표 (2분 HRR)
   * 는 "N일 달림" 이 러닝 일수를 덜 세므로 다른 명사를 쓴다.
   */
  coverageNoun?: string;
  /**
   * #449: 값의 방향 — 기간 비교 푸터가 선택 지표에 맞는 안내를 고른다. lower = 낮을수록 좋음 (안정시 심박 · 페이스 · 스트레스 · 체중),
   * higher = 클수록 좋음 (거리 · HRR · 수면 점수 · VO2max), none = 좋고 나쁨 없음 (걸음 · 칼로리). 차이 셀에 색은 여전히 넣지 않는다 (#395).
   */
  betterWhen: "lower" | "higher" | "none";
};

export const HISTORY_METRIC_IDS = [
  "runningKm",
  "runningCount",
  "runningDurationSec",
  "steps",
  "activeCalories",
  "sleepScore",
  "restingHR",
  "hrv",
  "stress",
  "weight",
  "vo2max",
  "ltPace",
  "calorieBalance",
  "intakeKcal",
  "hrr2",
] as const;
export type HistoryMetricId = (typeof HISTORY_METRIC_IDS)[number];

const base = { missingAsZero: false, withMinMax: false, withLast: false, selectable: true, format: "number", sparse: false } as const;

export const HISTORY_METRICS: readonly HistoryMetricDef[] = [
  { ...base, id: "runningKm", label: "러닝 거리", unit: "km", decimals: 2, betterWhen: "higher", source: "activity", kind: "km", aggregate: "sum", missingAsZero: true },
  { ...base, id: "runningCount", label: "러닝 횟수", unit: "회", decimals: 0, betterWhen: "higher", source: "activity", kind: "count", aggregate: "sum", missingAsZero: true },
  { ...base, id: "runningDurationSec", label: "러닝 시간", unit: "초", decimals: 0, betterWhen: "none", source: "activity", kind: "duration", aggregate: "sum", missingAsZero: true, selectable: false },
  { ...base, id: "steps", label: "걸음", unit: "보", decimals: 0, betterWhen: "none", source: "daily", field: "steps", aggregate: "sum" },
  { ...base, id: "activeCalories", label: "활성 칼로리", unit: "kcal", decimals: 0, betterWhen: "none", source: "daily", field: "activeCalories", aggregate: "sum" },
  { ...base, id: "sleepScore", label: "수면 점수", unit: "점", decimals: 0, betterWhen: "higher", source: "sleep", field: "sleepScore", aggregate: "avg", withMinMax: true },
  { ...base, id: "restingHR", label: "안정시 심박", unit: "bpm", decimals: 0, betterWhen: "lower", source: "daily", field: "restingHR", aggregate: "avg", withMinMax: true },
  { ...base, id: "hrv", label: "야간 HRV", unit: "ms", decimals: 1, betterWhen: "higher", source: "sleep", field: "hrvOvernight", aggregate: "avg" },
  { ...base, id: "stress", label: "평균 스트레스", unit: "", decimals: 0, betterWhen: "lower", source: "daily", field: "avgStress", aggregate: "avg" },
  { ...base, id: "weight", label: "체중", unit: "kg", decimals: 1, betterWhen: "lower", source: "body", field: "weight", aggregate: "avg", withMinMax: true, withLast: true, sparse: true },
  { ...base, id: "vo2max", label: "VO2max", unit: "", decimals: 1, betterWhen: "higher", source: "fitness", field: "vo2maxRunning", aggregate: "max", withLast: true },
  { ...base, id: "ltPace", label: "젖산역치 페이스", unit: "sec/km", decimals: 0, betterWhen: "lower", source: "fitness", field: "lthrPace", aggregate: "last", format: "pace", sparse: true },
  { ...base, id: "calorieBalance", label: "칼로리 밸런스", unit: "kcal", decimals: 0, betterWhen: "none", source: "daily", field: "calorieBalance", aggregate: "avg" },
  // #394: 식단 캘린더 (M14 백로그 B-2) 를 월 그리드 지표로 흡수. FoodLog 는 2026~ 라 그 이전은 전부 결측.
  { ...base, id: "intakeKcal", label: "섭취 칼로리", unit: "kcal", decimals: 0, betterWhen: "none", source: "daily", field: "estimatedIntakeCalories", aggregate: "avg" },
  // #442 (M17-3): 러닝 종료 후 2분 HRR (`Activity.hrr2`, #425). 버킷 = 중앙값 (패널 E 와 동일), 띠 = 최저~최고 (인터벌 · 레이스의 큰 값이 보이게).
  // sparse — 주에 러닝 2~3건뿐인 것이 정상이라 커버리지 흐림을 적용하지 않는다. 프로덕션은 2026-04 부터 (Garmin 보존 창 · #431).
  { ...base, id: "hrr2", label: "2분 HRR", unit: "bpm", decimals: 0, betterWhen: "higher", source: "activity", kind: "hrr2", aggregate: "median", withMinMax: true, sparse: true, startNote: "종료 후 심박은 {from} 부터 있습니다", coverageNoun: "회복 기록" },
];

/** `/history` 지표 선택기 기본 5개 (m15-overview D3 — 사용자 확정 2026-09-18). 나머지 selectable 지표는 "추가" 그룹. */
export const HISTORY_PRIMARY_METRIC_IDS = ["runningKm", "steps", "sleepScore", "restingHR", "weight"] as const satisfies readonly HistoryMetricId[];
export const DEFAULT_HISTORY_METRIC_ID: HistoryMetricId = "runningKm";

export function selectableHistoryMetrics(): readonly HistoryMetricDef[] {
  return HISTORY_METRICS.filter((m) => m.selectable);
}

const byId: ReadonlyMap<HistoryMetricId, HistoryMetricDef> = new Map(HISTORY_METRICS.map((m) => [m.id, m]));

export function isHistoryMetricId(value: unknown): value is HistoryMetricId {
  return typeof value === "string" && byId.has(value as HistoryMetricId);
}

export function getHistoryMetric(id: HistoryMetricId): HistoryMetricDef {
  const def = byId.get(id);
  if (!def) throw new Error(`미등록 히스토리 지표: ${String(id)}`);
  return def;
}
