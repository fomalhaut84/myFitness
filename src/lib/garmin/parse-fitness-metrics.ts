// #378: Garmin 성과통계 이력 파서 — VO2max 일별(maxmet) + 러닝 젖산역치(HR·속도) 감지일.
// prisma 를 끌어오지 않는 순수 모듈 — sync fetcher 와 verify 스크립트가 공유한다.
//
// 엔드포인트 실측 (2026-09-17 로컬 probe, #377 스펙 §1-3):
// - maxmet/daily/{start}/{end}: `[{ generic: { calendarDate, vo2MaxPreciseValue, vo2MaxValue, fitnessAge }, cycling, heatAltitudeAcclimation }]`
//   2020-06-26 부터 거의 매일 1 row. 367일 범위 허용.
// - stats/lactateThreshold{HeartRate,Speed}/range/{start}/{end}?sport=RUNNING&aggregation=daily:
//   `[{ from, until, series: "running", value, updatedDate }]`. 감지일만 (연 5~8 row). **366일 초과 시 400**.
//   speed 는 ×10 = m/s (user-profile 규칙과 동일).

export interface MaxMetRow {
  generic?: {
    calendarDate?: unknown;
    vo2MaxPreciseValue?: unknown;
    vo2MaxValue?: unknown;
    fitnessAge?: unknown;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface LactateThresholdRow {
  from?: unknown;
  until?: unknown;
  series?: unknown;
  value?: unknown;
  updatedDate?: unknown;
  [key: string]: unknown;
}

export interface FitnessMetricParsed {
  /** KST 달력 날짜 YYYY-MM-DD */
  date: string;
  vo2maxRunning: number | null;
  /** bpm */
  lthr: number | null;
  /** sec/km */
  lthrPace: number | null;
  fitnessAge: number | null;
  rawData: {
    maxmet?: MaxMetRow;
    lthr?: LactateThresholdRow;
    ltSpeed?: LactateThresholdRow;
  };
}

/** LT range 엔드포인트가 366일 초과에 400 을 돌려주므로 청크 폭은 365일 (양끝 포함). */
export const FITNESS_METRICS_CHUNK_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;
const YMD_RE = /^\d{4}-\d{2}-\d{2}/;

function ymdKST(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
}

/** [start, end] (KST 달력, 양끝 포함) 를 최대 maxDays 일 청크로 분할. 과거→최신 순. */
export function splitDateRange(
  start: Date,
  end: Date,
  maxDays: number = FITNESS_METRICS_CHUNK_DAYS,
): ReadonlyArray<{ start: Date; end: Date }> {
  if (!Number.isInteger(maxDays) || maxDays < 1) {
    throw new Error(`maxDays 는 1 이상 정수여야 합니다 (받은 값: ${maxDays})`);
  }
  const first = new Date(`${ymdKST(start)}T00:00:00+09:00`);
  const last = new Date(`${ymdKST(end)}T00:00:00+09:00`);
  if (first.getTime() > last.getTime()) return [];

  const chunks: Array<{ start: Date; end: Date }> = [];
  let cursor = first;
  while (cursor.getTime() <= last.getTime()) {
    const chunkEnd = new Date(
      Math.min(cursor.getTime() + (maxDays - 1) * DAY_MS, last.getTime()),
    );
    chunks.push({ start: cursor, end: chunkEnd });
    cursor = new Date(chunkEnd.getTime() + DAY_MS);
  }
  return chunks;
}

/**
 * Garmin lactateThresholdSpeed(×10 = m/s) → sec/km. user-profile.ts 의 speedToPaceSec 와 같은 규칙
 * (1000 / (value × 10) = 100 / value, 정수 초 반올림). 0·음수·비숫자는 null.
 */
export function ltSpeedToPaceSec(speed: unknown): number | null {
  const n = toNumber(speed);
  if (n === null || n <= 0) return null;
  return Math.round(100 / n);
}

/** `YYYY-MM-DD` 또는 `YYYY-MM-DDTHH:mm...` 문자열에서 달력 날짜만. 형식이 다르면 null. */
export function calendarDateOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = YMD_RE.exec(value);
  if (!m) return null;
  const ymd = m[0];
  // 2월 30일 등 무효 날짜 방지 — KST 로 파싱해 되돌린 값이 같아야 한다.
  const parsed = new Date(`${ymd}T00:00:00+09:00`);
  if (Number.isNaN(parsed.getTime()) || ymdKST(parsed) !== ymd) return null;
  return ymd;
}

/** KST 달력 날짜 → KST 자정 instant (#364 규칙). */
export function kstMidnight(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+09:00`);
}

function toNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function toInt(val: unknown): number | null {
  const n = toNumber(val);
  return n === null ? null : Math.round(n);
}

/** 응답이 배열이 아니면(빈 객체·HTML 등) 빈 배열로. 경계 검증은 호출부(fetcher)가 경고 로그. */
export function asRowArray<T>(response: unknown): readonly T[] {
  return Array.isArray(response) ? (response as T[]) : [];
}

/**
 * 세 엔드포인트 응답을 날짜 키로 병합. 값이 하나도 없는 날짜는 제외. 날짜 오름차순.
 * - maxmet 는 `generic.calendarDate`, LT 는 `from` (aggregation=daily 는 from == until) 을 키로.
 * - `after`(YYYY-MM-DD) 를 주면 그보다 늦은 날짜는 버린다 (미래 날짜 가드 — 호출부가 오늘(KST) 전달).
 * - 같은 날짜가 두 번 오면 뒤 row 가 이긴다 (Garmin 이 중복을 주는 경우는 관찰되지 않았다).
 */
export function mergeFitnessMetrics(
  maxmet: readonly MaxMetRow[],
  lthr: readonly LactateThresholdRow[],
  ltSpeed: readonly LactateThresholdRow[],
  options: { after?: string } = {},
): FitnessMetricParsed[] {
  const byDate = new Map<string, FitnessMetricParsed>();
  const get = (date: string): FitnessMetricParsed =>
    byDate.get(date) ?? {
      date,
      vo2maxRunning: null,
      lthr: null,
      lthrPace: null,
      fitnessAge: null,
      rawData: {},
    };

  for (const row of maxmet) {
    const date = calendarDateOf(row?.generic?.calendarDate);
    if (!date) continue;
    const g = row.generic ?? {};
    const vo2 = toNumber(g.vo2MaxPreciseValue) ?? toNumber(g.vo2MaxValue);
    const prev = get(date);
    byDate.set(date, {
      ...prev,
      vo2maxRunning: vo2 ?? prev.vo2maxRunning,
      fitnessAge: toInt(g.fitnessAge) ?? prev.fitnessAge,
      rawData: { ...prev.rawData, maxmet: row },
    });
  }

  for (const row of lthr) {
    const date = calendarDateOf(row?.from);
    if (!date) continue;
    const prev = get(date);
    byDate.set(date, {
      ...prev,
      lthr: toInt(row.value) ?? prev.lthr,
      rawData: { ...prev.rawData, lthr: row },
    });
  }

  for (const row of ltSpeed) {
    const date = calendarDateOf(row?.from);
    if (!date) continue;
    const prev = get(date);
    byDate.set(date, {
      ...prev,
      lthrPace: ltSpeedToPaceSec(row.value) ?? prev.lthrPace,
      rawData: { ...prev.rawData, ltSpeed: row },
    });
  }

  return [...byDate.values()]
    .filter((r) => !options.after || r.date <= options.after)
    .filter(
      (r) =>
        r.vo2maxRunning !== null ||
        r.lthr !== null ||
        r.lthrPace !== null ||
        r.fitnessAge !== null,
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
