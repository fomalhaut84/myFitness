// #413: YoY 뷰의 글자 대응물 — 연도 × 12개월 값 · 링크 (차트의 점 클릭과 같은 경로)
import { describe, expect, it } from "vitest";
import type { YearPivot } from "../trends";
import { yoyLinkRows } from "../yoy-links";

const cell = (value: number | null, partial: "current" | "clipped" | null = null) =>
  value === null ? null : { value, coveredDays: 20, totalDays: 30, lowCoverage: false, partial };
const pivot: YearPivot = {
  years: [2024, 2026],
  cells: {
    2024: [cell(10), cell(null), ...Array.from({ length: 10 }, () => null)],
    2026: [cell(12), cell(8, "current"), ...Array.from({ length: 10 }, () => null)],
  },
};

describe("yoyLinkRows", () => {
  it("연도 내림차순 · 12칸 · href 는 월 뷰 + 지표 쿼리 (기본 지표는 생략)", () => {
    const rows = yoyLinkRows(pivot, "sleepScore");
    expect(rows.map((r) => r.year)).toEqual([2026, 2024]);
    expect(rows[0].months).toHaveLength(12);
    expect(rows[0].months[0]).toEqual({ month: 1, value: 12, partial: null, lowCoverage: false, href: "/history/2026/01?metric=sleepScore" });
    expect(rows[0].months[1]).toMatchObject({ month: 2, value: 8, partial: "current" });
    expect(yoyLinkRows(pivot, "runningKm")[1].months[0].href).toBe("/history/2024/01");
  });

  it("값 없는 달은 value · href 둘 다 null", () => {
    const rows = yoyLinkRows(pivot, "sleepScore");
    expect(rows[1].months[1]).toEqual({ month: 2, value: null, partial: null, lowCoverage: false, href: null });
    expect(rows[1].months[11].href).toBeNull();
  });
});
