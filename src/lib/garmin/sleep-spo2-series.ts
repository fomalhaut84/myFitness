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

/** 차트용 포인트 — 센서 공백 구간은 `v: null` 로 선을 끊는다. */
export interface SpO2ChartPoint {
  t: number;
  v: number | null;
}

/**
 * 선을 끊는 공백 임계.
 *
 * X축을 수치 시간축으로 쓰면 **간격 자체는 이미 정확히 표현된다** — 5분 공백은 1분
 * 간격의 5배 폭으로 그려진다. 여기서 추가로 선을 끊는 것은 "이 구간은 보간조차
 * 신뢰할 수 없다" 를 말하기 위해서다.
 *
 * 실측(6야간)에서 5~6분 공백은 야간당 2~3회 발생하는 정상적인 센서 재측정 주기다.
 * 이 정도를 끊으면 차트가 이유 없이 조각나고, 그 5분 동안 SpO2 가 선형에서 크게
 * 벗어났다고 볼 근거도 없다. 반면 10분 이상 끊긴 구간은 측정 중단에 가까워 선으로
 * 이으면 없는 데이터를 주장하게 된다.
 */
export const SPO2_GAP_BREAK_MS = 10 * 60 * 1000;

/**
 * 시계열을 차트용으로 변환하면서 **센서 공백을 명시적으로 끊는다**.
 *
 * 끊지 않으면 60분 dropout 을 사이에 둔 두 포인트가 1분 간격 포인트와 똑같이 선으로
 * 이어져, "저점이 얼마나 오래 지속됐나" 를 오독하게 만든다 (Codex P2). X축을 수치
 * 시간축으로 쓰는 것과 짝이 되는 처리 — 축만 바꾸면 간격은 맞지만 공백 위를 직선이
 * 가로지른다.
 *
 * 공백 직후에 `v: null` 포인트를 넣어 Area/Line 이 끊기게 한다 (`connectNulls={false}`).
 */
export function buildSpO2ChartSeries(
  series: SpO2Point[],
  gapMs: number = SPO2_GAP_BREAK_MS,
): SpO2ChartPoint[] {
  const out: SpO2ChartPoint[] = [];
  for (let i = 0; i < series.length; i += 1) {
    const prev = series[i - 1];
    if (prev && series[i].t - prev.t > gapMs) {
      // 직전 포인트 바로 뒤에 단절점을 둔다 — 공백 구간이 빈 채로 남는다.
      out.push({ t: prev.t + 1, v: null });
    }
    out.push({ t: series[i].t, v: series[i].v });
  }
  return out;
}

/** SpO2 차트 Y축 설정 — 하한과 눈금이 함께 결정되어야 하므로 한 곳에서 낸다. */
export interface SpO2AxisConfig {
  yMin: number;
  ticks: number[];
}

/**
 * Y축 하한과 눈금을 계산한다.
 *
 * **하한을 임의로 고정하지 않는다** (#342, Codex P2). 초안은 `Math.max(70, …)` 으로
 * 하한을 막았지만, Recharts 는 기본 `allowDataOverflow={false}` 라 지정 domain 보다
 * 데이터가 낮으면 **domain 을 데이터에 맞춰 늘린다** — 하한 지정이 사실상 무효였고,
 * 코드만 의도를 잘못 주장하고 있었다.
 *
 * `allowDataOverflow={true}` 로 잘라내는 선택지는 버렸다. 실측 저점을 그래프에서
 * 지우면 Stat 카드의 최저값과 어긋나는데, 이는 `readingConfidence` 필터링을 넣지 않은
 * 이유(§4.4)와 같은 문제다. **낮은 값이 있으면 스케일이 눌리더라도 보여주는 쪽**이 맞다.
 *
 * 대신 눈금을 하한에 맞춰 생성해, 확장된 구간이 라벨 없이 남지 않게 한다.
 */
export function spo2ChartYAxis(minValue: number): SpO2AxisConfig {
  // 평상시(83~100)에 실변동이 하단에 눌리지 않도록 80 을 기본 하한으로 두되,
  // 그보다 낮은 관측이 있으면 그 값을 담는다.
  const yMin = Math.min(80, Math.floor(minValue) - 2);
  const span = 100 - yMin;
  const step = span <= 25 ? 5 : span <= 50 ? 10 : 20;

  const ticks: number[] = [];
  for (let v = Math.ceil(yMin / step) * step; v <= 100; v += step) ticks.push(v);
  // 하한 라벨은 첫 눈금과 충분히 떨어져 있을 때만 추가 (겹침 방지).
  if (ticks.length === 0 || ticks[0] - yMin >= step / 2) ticks.unshift(yMin);

  return { yMin, ticks };
}
