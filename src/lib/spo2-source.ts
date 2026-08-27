// #341: SpO2 값의 출처 판정.
//
// 대시보드는 수면 SpO2(야간 측정)가 없을 때 주간 SpO2(`DailySummary.avgSpo2`, 활동 중
// 산발 측정)로 폴백한다. 두 값은 측정 환경이 달라 의미가 다르므로 출처를 숨기지 않는다
// — #338 에서 확정한 AI 지침("null 이면 미측정, 주간값으로 대체 판단 금지")과 화면이
// 어긋나지 않도록.
//
// 판정 로직을 이 모듈로 모은 이유: 서버 컴포넌트(page.tsx) · 클라이언트(dashboard-client)
// · 회귀 테스트가 같은 함수를 쓰게 해서, 한쪽만 바뀌어 조용히 갈라지는 것을 막는다.

export type SpO2Source = "sleep" | "daily" | null;

/**
 * SpO2 유효값 판정.
 *
 * `(0, 100]` 밖은 센서 오류·sentinel 로 본다 — `SleepRecord.avgSpO2` 는 ingest 단계
 * (`fetchers/sleep-spo2.ts`)에서 이미 걸러지지만, `DailySummary.avgSpo2` 는 `toFloat` 로
 * 저장되어 `0` 이 그대로 들어올 수 있다. 표시 직전에 한 번 더 막는다.
 */
export function validSpO2(val: number | null | undefined): number | null {
  return typeof val === "number" && Number.isFinite(val) && val > 0 && val <= 100
    ? val
    : null;
}

/** 수면값 우선, 없으면 주간값. 둘 다 없으면 null. */
export function resolveSpO2Source(
  sleepAvg: number | null | undefined,
  dailyAvg: number | null | undefined,
): SpO2Source {
  if (validSpO2(sleepAvg) !== null) return "sleep";
  if (validSpO2(dailyAvg) !== null) return "daily";
  return null;
}

/** 표시할 SpO2 값 (출처 우선순위 동일). */
export function resolveSpO2Value(
  sleepAvg: number | null | undefined,
  dailyAvg: number | null | undefined,
): number | null {
  return validSpO2(sleepAvg) ?? validSpO2(dailyAvg);
}

/** 대시보드 카드 라벨 — 주간값으로 폴백했음을 숨기지 않는다. */
export function spo2CardLabel(source: SpO2Source): string {
  return source === "daily" ? "SpO2 (주간)" : "SpO2";
}

/**
 * 어제 대비 delta 에 쓸 값.
 *
 * 출처가 다르면 서로 다른 측정 종류를 빼게 되므로 비교하지 않는다
 * (예: 오늘=수면 94%, 어제=주간 91% → "+3" 은 의미 없는 숫자).
 */
export function comparablePrevSpO2(
  todaySource: SpO2Source,
  prevSource: SpO2Source,
  prevValue: number | null,
): number | null {
  if (prevValue === null || todaySource === null) return null;
  return prevSource === todaySource ? prevValue : null;
}
