/**
 * #383: 워치 미착용 날의 빈 Garmin 응답 판정 (순수 · prisma 없음 — fetcher · 정리 스크립트 · verify 가 공유).
 *
 * Garmin 은 데이터가 없는 날에도 `calendarDate` 가 있는 응답을 돌려준다 (2019-08-01 실측: 86키 중
 * userProfileId/displayName/calendarDate/source 만 non-null, `includesWellnessData:false`). 이전 fetcher 는
 * `calendarDate` 만 검사해 이런 날을 빈 stub 행으로 저장했다 — v2.28.0 backfill 로 2019-06~2020-06 구간에
 * DailySummary 367행 · HeartRateRecord 326행+ 가 생겨 `get_data_coverage` 의 "기록 시작" 이 1년 앞당겨졌다.
 */

/** DailySummary 핵심 지표 — 전부 null/0 이면 워치 미착용(빈 날)으로 본다. */
export const DAILY_SUMMARY_CORE_FIELDS = [
  "totalSteps",
  "restingHeartRate",
  "totalKilocalories",
  "bodyBatteryHighestValue",
] as const;

/**
 * null/undefined/0 → "없음". 비수치 문자열("N/A" 등)도 없음으로 본다 — Garmin 은 숫자 필드를 숫자 또는 null 로만
 * 돌려주므로 그런 값은 데이터가 아니라고 판단한다 (사전 리뷰 info 2: 의도 명시).
 */
function isNullOrZero(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const n = Number(v);
  return Number.isNaN(n) || n === 0;
}

/** 핵심 지표(걸음·안정시HR·총칼로리·바디배터리 최고)가 전부 null/0 → 빈 날. */
export function isEmptyDailySummary(summary: Record<string, unknown>): boolean {
  return DAILY_SUMMARY_CORE_FIELDS.every((k) => isNullOrZero(summary[k]));
}

/**
 * A11 (감사 2026-09-17): `privacyProtected === true` 는 데이터 없음이 아니라 토큰/권한 이상이다.
 * 정상 stub 으로 저장하지 말고 인증 실패로 분류해 싱크를 실패시킨다 (다음 싱크에서 같은 범위 재시도).
 */
export function isPrivacyProtected(summary: Record<string, unknown>): boolean {
  return summary.privacyProtected === true;
}

/** restingHeartRate 도 없고 heartRateValues 도 비어 있으면 빈 날. */
export function isEmptyHeartRate(raw: Record<string, unknown>): boolean {
  const values = raw.heartRateValues;
  const hasValues = Array.isArray(values) && values.length > 0;
  return isNullOrZero(raw.restingHeartRate) && !hasValues;
}

/** DailySummary 의 핵심 4개 밖 지표 컬럼 — 삭제 조건은 이것까지 전부 null 이어야 한다. */
export const DAILY_SUMMARY_OTHER_METRIC_COLUMNS = [
  "activeCalories",
  "avgStress",
  "bodyBattery",
  "bodyBatteryLow",
  "intensityMin",
  "floorsClimbed",
  "avgSpo2",
  "lowestSpo2",
  "avgRespiration",
  "stressHighDuration",
  "stressMediumDuration",
  "stressLowDuration",
  "bodyBatteryCharged",
  "bodyBatteryDrained",
  "estimatedIntakeCalories",
  "availableCalories",
  "calorieBalance",
] as const;

const coreNullOrZero = (field: "steps" | "restingHR" | "totalCalories" | "bodyBatteryHigh") => ({
  OR: [{ [field]: null }, { [field]: 0 }],
});

/** fetcher 의 skip 조건을 DB 컬럼으로 옮긴 것 (핵심 4개 null/0). 삭제 조건이 아니라 "핵심 지표 없음" 진단용. */
export function coreEmptyDailySummaryWhere() {
  return {
    AND: [
      coreNullOrZero("steps"),
      coreNullOrZero("restingHR"),
      coreNullOrZero("totalCalories"),
      coreNullOrZero("bodyBatteryHigh"),
    ],
  };
}

/**
 * 기존 stub 행 **삭제** 조건 (scripts/cleanup-stub-days.ts). fetcher 의 skip 조건보다 의도적으로 엄격하다
 * (사전 리뷰 major 2): skip 은 다음 싱크에 복구되지만 deleteMany 는 되돌릴 수 없으므로, 핵심 4개뿐 아니라
 * 나머지 지표 컬럼까지 전부 null 인 행만 지운다. `estimatedIntakeCalories`(식단 기록일) · `calorieBalance` 도 포함 —
 * 워치는 안 찼지만 식단은 기록한 날은 칼로리 밸런스 이력이라 보호된다. 2019-06~2020-06 stub 은 전 컬럼 null 이라 그대로 잡힌다.
 */
export function emptyDailySummaryWhere() {
  return {
    AND: [
      ...coreEmptyDailySummaryWhere().AND,
      ...DAILY_SUMMARY_OTHER_METRIC_COLUMNS.map((col) => ({ [col]: null })),
    ],
  };
}

/** HeartRateRecord 는 저장 컬럼이 전부 null 인 행만 (avgHR 은 heartRateValues 에서 파생, hrvBaseline 은 미래 대비). */
export function emptyHeartRateWhere() {
  return {
    restingHR: null,
    avgHR: null,
    maxHR: null,
    minHR: null,
    hrvStatus: null,
    hrvBaseline: null,
  };
}
