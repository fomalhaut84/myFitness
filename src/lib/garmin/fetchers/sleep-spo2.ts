// #338: Garmin 수면 SpO2 파싱.
//
// 기존 구현은 `averageSpo2` 라는 존재하지 않는 키를 읽어 전 기간 null 로 저장됐다.
// 실제 Garmin `dailySleepDTO` 필드는 `averageSpO2Value` / `lowestSpO2Value` /
// `highestSpO2Value` 이며, top-level `wellnessSpO2SleepSummaryDTO` 에
// `averageSPO2` / `lowestSPO2` 가 중복 제공된다 (대소문자 관례가 다르다는 점에 주의).
//
// 파싱을 fetcher 에서 분리해 순수 함수로 둔 이유: 같은 오타가 재발하지 않도록
// 실제 payload shape 픽스처로 회귀 테스트를 걸기 위함 (scripts/test-sleep-spo2-parse.ts).

export interface SleepSpO2 {
  /** 수면 중 평균 SpO2 (%) */
  avg: number | null;
  /** 수면 중 최저 SpO2 (%) — 야간 저산소 이벤트 판단의 기준값 */
  lowest: number | null;
  /** 수면 중 최고 SpO2 (%) */
  highest: number | null;
}

/**
 * SpO2 는 백분율이므로 (0, 100] 밖의 값은 센서 오류 · sentinel 로 보고 버린다.
 * `Number("")` 이 0 이 되는 함정 때문에 빈 문자열도 명시적으로 걸러낸다.
 */
function toSpO2(val: unknown): number | null {
  if (typeof val === "number") {
    return Number.isFinite(val) && val > 0 && val <= 100 ? val : null;
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
  }
  return null;
}

function asRecord(val: unknown): Record<string, unknown> | null {
  return typeof val === "object" && val !== null && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : null;
}

/**
 * Garmin `getSleepData` 응답에서 수면 SpO2 3종을 추출한다.
 *
 * 필드별로 독립 폴백한다 — 평균만 있고 최저가 결측인 야간도 평균은 살린다.
 * `wellnessSpO2SleepSummaryDTO` 에는 highest 대응 필드가 없어 폴백 대상이 아니다.
 */
export function extractSleepSpO2(sleepData: unknown): SleepSpO2 {
  const root = asRecord(sleepData);
  const dto = asRecord(root?.dailySleepDTO);
  const summary = asRecord(root?.wellnessSpO2SleepSummaryDTO);

  return {
    avg: toSpO2(dto?.averageSpO2Value) ?? toSpO2(summary?.averageSPO2),
    lowest: toSpO2(dto?.lowestSpO2Value) ?? toSpO2(summary?.lowestSPO2),
    highest: toSpO2(dto?.highestSpO2Value),
  };
}
