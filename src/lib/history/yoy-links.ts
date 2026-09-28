// #413: YoY 뷰의 글자 대응물 — Recharts 점은 마우스 · 터치 전용이고 차트는 role="img" 라 AT 경로가 없다.
// 연도 × 12개월의 값과 월 뷰 링크를 순수 데이터로 만들어 서버 컴포넌트 표 (`YoyMonthTable`) 가 <a> 로 그린다.
import type { HistoryMetricId } from "./metrics";
import { historyMetricQuery, historyMonthPath } from "./route-params";
import type { PartialReason, YearPivot } from "./trends";

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
