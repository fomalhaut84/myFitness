// #413: YoY 뷰의 글자 대응물 — Recharts 점은 마우스 · 터치 전용이고 차트는 role="img" 라 AT 경로가 없다.
// 연도 × 12개월의 값과 월 뷰 링크를 순수 데이터로 만들어 서버 컴포넌트 표 (`YoyMonthTable`) 가 <a> 로 그린다.
import type { HistoryMetricId } from "./metrics";
import { historyMetricQuery, historyMonthPath } from "./route-params";
import { PARTIAL_LABELS, type PartialReason, type YearPivot } from "./trends";

export interface YoyLinkCell {
  month: number;
  value: number | null;
  partial: PartialReason | null;
  lowCoverage: boolean;
  /** 값 없는 달은 null */
  href: string | null;
}

export interface YoyLinkRow {
  year: number;
  months: YoyLinkCell[];
}

/** 연도 내림차순 (최근이 위). href 는 차트의 점 클릭과 같은 경로 (`/history/YYYY/MM?metric=` · 기본 지표는 쿼리 생략) */
export function yoyLinkRows(pivot: YearPivot, metricId: HistoryMetricId): YoyLinkRow[] {
  const query = historyMetricQuery(metricId);
  return [...pivot.years]
    .sort((a, b) => b - a)
    .map((year) => ({
      year,
      months: Array.from({ length: 12 }, (_, i) => {
        const month = i + 1;
        const c = pivot.cells[year]?.[i] ?? null;
        if (c === null || c.value === null) return { month, value: null, partial: null, lowCoverage: false, href: null };
        return {
          month,
          value: c.value,
          partial: c.partial,
          lowCoverage: c.lowCoverage,
          href: `${historyMonthPath(`${year}-${String(month).padStart(2, "0")}`)}${query}`,
        };
      }),
    }));
}

/** 표에 값이 하나라도 있는가 — 전부 null 이면 표 자체를 그리지 않는다 (사전 리뷰 info 2) */
export function hasAnyYoyValue(rows: readonly YoyLinkRow[]): boolean {
  return rows.some((r) => r.months.some((m) => m.value !== null));
}

/**
 * 링크의 스크린리더용 안내 (사전 리뷰 major 1): Tab · 링크 목록에서는 `th` 헤더가 읽히지 않아 값만 들린다 → 연 · 월과 상태를
 * 글자로. 미완결 표시는 차트 (`buildYoyRows`) 와 같이 **합계형에서만** (info 4). 저커버리지는 흐림만으로는 전달되지 않는다.
 */
export function yoyCellAnnouncement(year: number, cell: YoyLinkCell, opts: { isSum: boolean }): string {
  const parts = [`${year}년 ${cell.month}월`];
  if (opts.isSum && cell.partial !== null) parts.push(PARTIAL_LABELS[cell.partial]);
  if (cell.lowCoverage) parts.push("기록 절반 미만");
  return parts.join(" · ");
}
