/**
 * #395 (M15-3): `/trends` 쿼리 파싱 · 기간 해석 · href 빌더. 순수 (today · lowerBound 주입).
 *
 * 상태는 전부 URL 쿼리에 있다 — 링크 하나로 같은 화면이 재현된다. 잘못된 값은 redirect 없이 **기본값으로 fallback**
 * (쿼리는 정규화하지 않는다). 기본값은 href 에서 생략해 URL 을 짧게 유지한다.
 */
import { bucketStartYmd } from "./buckets";
import { DEFAULT_HISTORY_METRIC_ID, getHistoryMetric, isHistoryMetricId, type HistoryMetricId } from "./metrics";
import { addMonthsYm, daysInYm, isValidYm } from "./month-cells";

export const TRENDS_PATH = "/trends";

export const TRENDS_VIEWS = ["series", "yoy", "season", "compare"] as const;
export type TrendsView = (typeof TRENDS_VIEWS)[number];

export const TRENDS_UNITS = ["week", "month", "year"] as const;
export type TrendsUnit = (typeof TRENDS_UNITS)[number];

export const TRENDS_RANGES = ["1y", "3y", "all"] as const;
export type TrendsRange = (typeof TRENDS_RANGES)[number];

export const DEFAULT_TRENDS_VIEW: TrendsView = "series";
export const DEFAULT_TRENDS_UNIT: TrendsUnit = "month";
export const DEFAULT_TRENDS_RANGE: TrendsRange = "3y";

/** 기간 → 오늘이 속한 달을 포함해 거슬러 올라가는 달 수 */
const RANGE_MONTHS: Record<Exclude<TrendsRange, "all">, number> = { "1y": 12, "3y": 36 };
/** 비교 뷰 기본 구간 길이 (완결 월) */
const DEFAULT_COMPARE_MONTHS = 3;

export interface MonthRange {
  fromYm: string;
  toYm: string;
}

export interface TrendsContext {
  today: string;
  lowerBound: string;
}

export interface TrendsQuery {
  view: TrendsView;
  metric: HistoryMetricId;
  unit: TrendsUnit;
  range: TrendsRange;
  /** 비교 구간 A (기준 — 기본은 1년 전 같은 달들) · B (대상 — 기본은 직전 완결 3개월). 표는 B − A */
  a: MonthRange;
  b: MonthRange;
}

type RawQuery = Record<string, string | string[] | undefined>;

function first(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function oneOf<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

function clampYm(ym: string, ctx: TrendsContext): string {
  const min = ctx.lowerBound.slice(0, 7);
  const max = ctx.today.slice(0, 7);
  if (ym < min) return min;
  if (ym > max) return max;
  return ym;
}

/** 기본 비교 구간. B = 직전 완결 N개월, A = 그 1년 전. 데이터가 1년 미만이면 범위로 클램프된다. */
export function defaultCompareRanges(ctx: TrendsContext): { a: MonthRange; b: MonthRange } {
  const todayYm = ctx.today.slice(0, 7);
  const bTo = clampYm(addMonthsYm(todayYm, -1), ctx);
  const bFrom = clampYm(addMonthsYm(bTo, -(DEFAULT_COMPARE_MONTHS - 1)), ctx);
  const aFrom = clampYm(addMonthsYm(bFrom, -12), ctx);
  const aTo = clampYm(addMonthsYm(bTo, -12), ctx);
  return { a: { fromYm: aFrom, toYm: aTo < aFrom ? aFrom : aTo }, b: { fromYm: bFrom, toYm: bTo } };
}

/** `YYYY-MM..YYYY-MM`. 형식 오류 · 역순 · 하한 이전 · 미래 → null (호출자가 기본 구간으로). */
export function parseMonthRange(raw: string | undefined, ctx: TrendsContext): MonthRange | null {
  if (!raw) return null;
  const parts = raw.split("..");
  if (parts.length !== 2) return null;
  const [fromYm, toYm] = parts;
  if (!isValidYm(fromYm) || !isValidYm(toYm) || fromYm > toYm) return null;
  if (fromYm < ctx.lowerBound.slice(0, 7) || toYm > ctx.today.slice(0, 7)) return null;
  return { fromYm, toYm };
}

export function formatMonthRange(range: MonthRange): string {
  return `${range.fromYm}..${range.toYm}`;
}

export function monthRangeLength(range: MonthRange): number {
  const [fy, fm] = range.fromYm.split("-").map(Number);
  const [ty, tm] = range.toYm.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

/** 월 구간 → 조회용 ymd 구간 (하한 · 오늘로 클램프). */
export function monthRangeToYmd(range: MonthRange, ctx: TrendsContext): { from: string; to: string } {
  const start = `${range.fromYm}-01`;
  const end = `${range.toYm}-${String(daysInYm(range.toYm)).padStart(2, "0")}`;
  return { from: start < ctx.lowerBound ? ctx.lowerBound : start, to: end > ctx.today ? ctx.today : end };
}

export function parseTrendsQuery(raw: RawQuery, ctx: TrendsContext): TrendsQuery {
  const metricRaw = first(raw.metric);
  const metric =
    isHistoryMetricId(metricRaw) && getHistoryMetric(metricRaw).selectable ? metricRaw : DEFAULT_HISTORY_METRIC_ID;
  const defaults = defaultCompareRanges(ctx);
  return {
    view: oneOf(first(raw.view), TRENDS_VIEWS, DEFAULT_TRENDS_VIEW),
    metric,
    unit: oneOf(first(raw.unit), TRENDS_UNITS, DEFAULT_TRENDS_UNIT),
    range: oneOf(first(raw.range), TRENDS_RANGES, DEFAULT_TRENDS_RANGE),
    a: parseMonthRange(first(raw.a), ctx) ?? defaults.a,
    b: parseMonthRange(first(raw.b), ctx) ?? defaults.b,
  };
}

/** 연 단위에서는 기간 선택이 의미가 없다 (6년 = 막대 7개) — 항상 전체. 컨트롤도 숨긴다. */
export function effectiveTrendsRange(range: TrendsRange, unit: TrendsUnit): TrendsRange {
  return unit === "year" ? "all" : range;
}

/**
 * 시계열 기간 → ymd 구간. `1y` = 이번 달 포함 12개 달. 하한으로 클램프.
 *
 * `from` 은 **단위의 버킷 시작으로 스냅** 한다. summary 는 첫 버킷을 달력 전체로 조회하므로 (#393), 스냅하지 않으면
 * 막대는 기간 밖 데이터를 포함하는데 "기간 전체" 판독값은 포함하지 않아 서로 어긋난다 (사전 리뷰 major 1).
 */
export function resolveTrendsRange(range: TrendsRange, unit: TrendsUnit, ctx: TrendsContext): { from: string; to: string } {
  const effective = effectiveTrendsRange(range, unit);
  if (effective === "all") return { from: ctx.lowerBound, to: ctx.today };
  const fromYm = addMonthsYm(ctx.today.slice(0, 7), -(RANGE_MONTHS[effective] - 1));
  const from = bucketStartYmd(`${fromYm}-01`, unit);
  return { from: from < ctx.lowerBound ? ctx.lowerBound : from, to: ctx.today };
}

/** 현재 쿼리 + 변경분 → href. 기본값은 생략. 비교 구간은 비교 뷰에서만, 기본 구간과 다를 때만 싣는다. */
export function buildTrendsHref(query: TrendsQuery, patch: Partial<TrendsQuery>, ctx: TrendsContext): string {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();
  if (next.view !== DEFAULT_TRENDS_VIEW) params.set("view", next.view);
  if (next.metric !== DEFAULT_HISTORY_METRIC_ID) params.set("metric", next.metric);
  // 단위 · 기간은 시계열 전용이지만 다른 탭에 다녀와도 유지되도록 항상 싣는다
  if (next.unit !== DEFAULT_TRENDS_UNIT) params.set("unit", next.unit);
  if (next.range !== DEFAULT_TRENDS_RANGE) params.set("range", next.range);
  if (next.view === "compare") {
    const defaults = defaultCompareRanges(ctx);
    if (formatMonthRange(next.a) !== formatMonthRange(defaults.a)) params.set("a", formatMonthRange(next.a));
    if (formatMonthRange(next.b) !== formatMonthRange(defaults.b)) params.set("b", formatMonthRange(next.b));
  }
  const qs = params.toString();
  // `..` 은 URLSearchParams 가 인코딩하지 않는다. 읽기 쉬운 URL 유지.
  return qs ? `${TRENDS_PATH}?${qs}` : TRENDS_PATH;
}
