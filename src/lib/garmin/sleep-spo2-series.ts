// #342: Garmin 수면 rawData 의 epoch 단위 SpO2 시계열 파싱.
//
// `SleepRecord.rawData.wellnessEpochSPO2DataDTOList` 에 1분 epoch 로 야간당 260~460개
// 포인트가 이미 보존되어 있다 (Garmin 앱 수면 SpO2 그래프의 소스). 추가 싱크나 스키마
// 변경 없이 그대로 쓴다.

export interface SpO2Point {
  /** epoch ms (UTC) */
  t: number;
  /** SpO2 % */
  v: number;
}

/**
 * ⚠️ `epochTimestamp` 는 `"2026-04-01T14:34:00.0"` — **타임존 접미사가 없는 GMT 문자열**이다.
 *
 * `new Date("2026-04-01T14:34:00.0")` 는 JS 사양상 이 형식(시각 포함 · 오프셋 없음)을
 * **로컬 타임존**으로 해석하므로 서버 TZ 에 따라 결과가 달라진다. KST 서버라면 9시간 밀린다.
 * 반드시 `"Z"` 를 붙여 UTC 로 명시 파싱한다.
 *
 * 근거: 같은 야간의 `wellnessSpO2SleepSummaryDTO.sleepMeasurementStartGMT` 와 첫 epoch 의
 * `epochTimestamp` 가 동일 문자열이고, `dailySleepDTO.sleepStartTimestampGMT` (epoch ms) 와도
 * 같은 instant 를 가리킨다.
 *
 * NOTE: weight API 의 naive-TZ 함정(KST wall-clock 을 UTC 로 표기)과는 **방향이 반대**다.
 * 이쪽은 값이 진짜 GMT 이고 표기만 누락된 경우다. 혼동 주의.
 */
function parseEpochTimestamp(val: unknown): number | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  if (trimmed === "") return null;
  // 이미 오프셋(Z 또는 ±HH:MM)이 붙어 있으면 그대로, 없으면 UTC 로 명시.
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed);
  const ms = Date.parse(hasOffset ? trimmed : `${trimmed}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** SpO2 는 백분율 — (0, 100] 밖은 센서 오류·sentinel 로 보고 버린다. */
function parseReading(val: unknown): number | null {
  const n = typeof val === "number" ? val : typeof val === "string" ? Number(val) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}

/**
 * rawData 에서 야간 SpO2 시계열을 추출한다.
 *
 * API 응답 순서를 신뢰하지 않고 시각 오름차순으로 정렬한다.
 * 파싱 불가한 element 는 건너뛴다 (전체를 버리지 않음 — 최저 지점이 사라지면
 * Stat 카드와 그래프가 어긋나므로 살릴 수 있는 포인트는 최대한 살린다).
 *
 * `readingConfidence` 는 1~27 범위로 관측되나 의미가 문서화되어 있지 않아 필터링에
 * 쓰지 않는다 (#342 §4.4).
 */
export function extractSleepSpO2Series(rawData: unknown): SpO2Point[] {
  if (typeof rawData !== "object" || rawData === null || Array.isArray(rawData)) {
    return [];
  }
  const list = (rawData as Record<string, unknown>).wellnessEpochSPO2DataDTOList;
  if (!Array.isArray(list)) return [];

  const points: SpO2Point[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const t = parseEpochTimestamp(e.epochTimestamp);
    const v = parseReading(e.spo2Reading);
    if (t === null || v === null) continue;
    points.push({ t, v });
  }

  return points.sort((a, b) => a.t - b.t);
}
