/**
 * #394 (M15-2): `/history/[year]/[month]/[day]` 세그먼트 검증. 순수 (today · lowerBound 주입).
 *
 * 연도 탭 · picker min/max · 라우트 검증이 같은 하한 (`getHistoryLowerBound`) 을 쓴다 (m15-overview D1).
 * 잘못된 URL 은 404 가 아니라 **같은 레벨의 가장 가까운 유효 값으로 redirect** 한다 — 미래는 오늘 쪽, 하한 이전은
 * 하한 쪽. 월·일은 2자리 zero-pad 가 정규형 (`/history/2024/3` → `/history/2024/03`) 이라 공유 링크가 하나로 수렴한다.
 */
import { isValidYmd } from "./buckets";
import { formatYm } from "./month-cells";

export const HISTORY_ROOT = "/history";

export type HistoryRoute =
  | { level: "year"; year: number }
  | { level: "month"; year: number; month: number; ym: string }
  | { level: "day"; year: number; month: number; day: number; ym: string; ymd: string };

export type HistoryRouteResult = { ok: true; route: HistoryRoute } | { ok: false; redirectTo: string };

export interface HistoryRouteContext {
  today: string;
  lowerBound: string;
}

export function historyYearPath(year: number): string {
  return `${HISTORY_ROOT}/${year}`;
}

export function historyMonthPath(ym: string): string {
  return `${HISTORY_ROOT}/${ym.replace("-", "/")}`;
}

export function historyDayPath(ymd: string): string {
  return `${HISTORY_ROOT}/${ymd.replaceAll("-", "/")}`;
}

function clamp(value: string, min: string, max: string): string {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function parseIntSegment(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,4}$/.test(raw)) return null;
  return Number(raw);
}

export function parseHistoryRoute(
  segments: { year: string; month?: string; day?: string },
  ctx: HistoryRouteContext,
): HistoryRouteResult {
  const redirect = (to: string): HistoryRouteResult => ({ ok: false, redirectTo: to });

  const year = parseIntSegment(segments.year);
  if (year === null || segments.year.length !== 4) return redirect(HISTORY_ROOT);

  const minYear = Number(ctx.lowerBound.slice(0, 4));
  const maxYear = Number(ctx.today.slice(0, 4));

  if (segments.month === undefined) {
    const clamped = Math.min(Math.max(year, minYear), maxYear);
    return clamped === year ? { ok: true, route: { level: "year", year } } : redirect(historyYearPath(clamped));
  }

  const month = parseIntSegment(segments.month);
  if (month === null || month < 1 || month > 12) return redirect(historyYearPath(Math.min(Math.max(year, minYear), maxYear)));
  const ym = formatYm(year, month);

  if (segments.day === undefined) {
    const clamped = clamp(ym, ctx.lowerBound.slice(0, 7), ctx.today.slice(0, 7));
    const canonical = historyMonthPath(clamped);
    const given = `${HISTORY_ROOT}/${segments.year}/${segments.month}`;
    return canonical === given ? { ok: true, route: { level: "month", year, month, ym } } : redirect(canonical);
  }

  const day = parseIntSegment(segments.day);
  const ymd = day === null ? null : `${ym}-${String(day).padStart(2, "0")}`;
  // 2월 30일 등 실존하지 않는 날짜는 그 달의 월 뷰로 (월 자체도 범위로 클램프)
  if (ymd === null || day === null || !isValidYmd(ymd)) {
    return redirect(historyMonthPath(clamp(ym, ctx.lowerBound.slice(0, 7), ctx.today.slice(0, 7))));
  }
  const canonical = historyDayPath(clamp(ymd, ctx.lowerBound, ctx.today));
  const given = `${HISTORY_ROOT}/${segments.year}/${segments.month}/${segments.day}`;
  return canonical === given ? { ok: true, route: { level: "day", year, month, day, ym, ymd } } : redirect(canonical);
}
