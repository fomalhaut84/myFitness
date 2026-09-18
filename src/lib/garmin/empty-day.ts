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

/**
 * 기존 stub 행 정리용 where (scripts/cleanup-stub-days.ts). fetcher 의 skip 조건을 DB 컬럼으로 옮긴 것.
 * `estimatedIntakeCalories` 가 있는 행(워치는 안 찼지만 식단은 기록한 날)은 보호 — 칼로리 밸런스 이력이라 삭제하지 않는다.
 */
export function emptyDailySummaryWhere() {
  const nullOrZero = (field: "steps" | "restingHR" | "totalCalories" | "bodyBatteryHigh") => ({
    OR: [{ [field]: null }, { [field]: 0 }],
  });
  return {
    AND: [
      nullOrZero("steps"),
      nullOrZero("restingHR"),
      nullOrZero("totalCalories"),
      nullOrZero("bodyBatteryHigh"),
      { estimatedIntakeCalories: null },
    ],
  };
}

/** HeartRateRecord 는 저장 컬럼이 전부 null 인 행만 (avgHR 은 heartRateValues 에서 파생). */
export function emptyHeartRateWhere() {
  return {
    restingHR: null,
    avgHR: null,
    maxHR: null,
    minHR: null,
    hrvStatus: null,
  };
}
