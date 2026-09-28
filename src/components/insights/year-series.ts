// #397 · #419: 연도 계열 조립 (순수) — `page.tsx` 에서 분리. 레이스 점은 계열 하나 (범례 1개) 지만 점마다 그 해의 연도 색을 윤곽으로 쓴다
// (PR #417 Codex P2 — 단일 중립색이 여러 해의 레이스와 연도 범례를 어긋나게 했다). 연도 토글은 `toggleId` 로 따른다 (사전 리뷰 info 6).
import { yearColor } from "@/components/trends/year-colors";
import type { ScatterPoint, ScatterSeries } from "./InsightScatter";

/** 레이스 계열의 범례 색 — 점의 실제 윤곽은 연도 색이라 범례는 "속 빈 점 = 레이스" 라는 모양만 말한다 */
export const RACE_LEGEND_COLOR = "#e5e5e5";

export function yearSeries<T extends { year: number }>(
  items: readonly T[],
  years: readonly number[],
  currentYear: number,
  toPoint: (item: T) => Omit<ScatterPoint, "toggleId" | "color">,
  color: string,
  race?: (item: T) => boolean,
): ScatterSeries[] {
  const colorOf = (year: number) => yearColor(year, years, currentYear, color);
  const byYear = years.map((year) => ({
    id: String(year),
    label: String(year),
    color: colorOf(year),
    points: items.filter((it) => it.year === year && !(race && race(it))).map(toPoint),
  }));
  if (!race) return byYear;
  const races = items.filter(race);
  if (races.length === 0) return byYear;
  return [
    ...byYear,
    {
      id: "race",
      label: "레이스",
      color: RACE_LEGEND_COLOR,
      hollow: true,
      points: races.map((it) => ({ ...toPoint(it), toggleId: String(it.year), color: colorOf(it.year) })),
    },
  ];
}
