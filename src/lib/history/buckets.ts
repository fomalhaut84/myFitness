/**
 * #393 (M15-1): KST 달력 버킷 헬퍼.
 *
 * 모든 계산은 KST 달력 문자열 `YYYY-MM-DD` 로 하고, DB 비교 instant 는 `kstInstant` 로만 만든다
 * (`todayKST` 패턴 — `${ymd}T00:00:00+09:00`). 날짜 산술은 합성 UTC 자정 Date 로 한다
 * (instant 의미 없음, 요일·일수 계산용 — `src/mcp/tools/aggregate.ts` 와 같은 방식).
 * 서버 TZ 에 의존하는 getter (`getFullYear`, `setDate`, `toLocaleString`) 는 쓰지 않는다 (#365).
 */

export const HISTORY_GRANULARITIES = ["day", "week", "month", "year"] as const;
export type HistoryGranularity = (typeof HISTORY_GRANULARITIES)[number];

export function isHistoryGranularity(value: unknown): value is HistoryGranularity {
  return typeof value === "string" && (HISTORY_GRANULARITIES as readonly string[]).includes(value);
}

export interface HistoryBucket {
  /** 시작일 기반 키: day `2024-03-15` · week `2024-03-11`(월요일) · month `2024-03` · year `2024` */
  key: string;
  granularity: HistoryGranularity;
  startYmd: string;
  /** exclusive */
  endYmd: string;
  /** KST 자정 instant (DB 비교용) */
  start: Date;
  end: Date;
  /** 달력 일수. 오늘 이후는 세지 않는다 (미래 일수로 커버리지가 희석되지 않도록). */
  totalDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** KST 날짜 문자열 → KST 자정 instant. */
export function kstInstant(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+09:00`);
}

/** KST 하루 [자정, 다음 자정). nutrition/lifestyle 의 인라인 `kstDayRange` 를 대체. */
export function kstDayRange(ymd: string): { start: Date; end: Date } {
  return { start: kstInstant(ymd), end: kstInstant(addDaysYmd(ymd, 1)) };
}

/** 형식 + 실존 (2월 30일 등 거부). 범위 검사는 하지 않는다 — 호출자 몫. */
export function isValidYmd(ymd: string): boolean {
  const m = YMD_RE.exec(ymd);
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  const utc = new Date(Date.UTC(y, mo - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === mo - 1 && utc.getUTCDate() === d;
}

function ymdToUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function utcToYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  return utcToYmd(new Date(ymdToUtc(ymd).getTime() + days * DAY_MS));
}

/** 두 날짜 차이 (b - a) 일수. */
export function diffDaysYmd(a: string, b: string): number {
  return Math.round((ymdToUtc(b).getTime() - ymdToUtc(a).getTime()) / DAY_MS);
}

/** 그 주 월요일. 일요일은 6일 전 (`startOfWeekKST` 와 같은 규칙). */
export function startOfWeekYmd(ymd: string): string {
  const utc = ymdToUtc(ymd);
  const dayNum = utc.getUTCDay() || 7; // Mon=1 … Sun=7
  return utcToYmd(new Date(utc.getTime() - (dayNum - 1) * DAY_MS));
}

export function startOfMonthYmd(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

export function startOfYearYmd(ymd: string): string {
  return `${ymd.slice(0, 4)}-01-01`;
}

export function bucketStartYmd(ymd: string, g: HistoryGranularity): string {
  switch (g) {
    case "day":
      return ymd;
    case "week":
      return startOfWeekYmd(ymd);
    case "month":
      return startOfMonthYmd(ymd);
    case "year":
      return startOfYearYmd(ymd);
  }
}

export function bucketKeyOf(ymd: string, g: HistoryGranularity): string {
  switch (g) {
    case "day":
      return ymd;
    case "week":
      return startOfWeekYmd(ymd);
    case "month":
      return ymd.slice(0, 7);
    case "year":
      return ymd.slice(0, 4);
  }
}

function nextBucketStartYmd(startYmd: string, g: HistoryGranularity): string {
  switch (g) {
    case "day":
      return addDaysYmd(startYmd, 1);
    case "week":
      return addDaysYmd(startYmd, 7);
    case "month": {
      const [y, m] = startYmd.split("-").map(Number);
      return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    }
    case "year":
      return `${Number(startYmd.slice(0, 4)) + 1}-01-01`;
  }
}

/**
 * `from` 이 속한 버킷부터 `to` 가 속한 버킷까지 **빈 버킷 포함** 생성. 첫/끝 버킷은 달력 전체
 * (`from`/`to` 로 자르지 않는다 — 월 뷰가 "3월 1일~31일" 을 기대). `todayYmd` 이후 일수는
 * totalDays 에 세지 않는다.
 */
export function enumerateBuckets(
  fromYmd: string,
  toYmd: string,
  g: HistoryGranularity,
  todayYmd: string,
): HistoryBucket[] {
  if (fromYmd > toYmd) return [];
  const tomorrow = addDaysYmd(todayYmd, 1);
  const lastStart = bucketStartYmd(toYmd, g);
  const buckets: HistoryBucket[] = [];
  for (let startYmd = bucketStartYmd(fromYmd, g); startYmd <= lastStart; startYmd = nextBucketStartYmd(startYmd, g)) {
    const endYmd = nextBucketStartYmd(startYmd, g);
    const countedEnd = endYmd < tomorrow ? endYmd : tomorrow;
    buckets.push({
      key: bucketKeyOf(startYmd, g),
      granularity: g,
      startYmd,
      endYmd,
      start: kstInstant(startYmd),
      end: kstInstant(endYmd),
      totalDays: Math.max(0, diffDaysYmd(startYmd, countedEnd)),
    });
  }
  return buckets;
}
