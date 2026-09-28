// #413: YoY 뷰의 글자 대응물 — 연도 × 12개월 값 · 링크 (차트의 점 클릭과 같은 경로)
import { describe, expect, it } from "vitest";
import type { YearPivot } from "../trends";
import { hasAnyYoyValue, yoyCellAnnouncement, yoyLinkRows } from "../yoy-links";

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

describe("yoyLinkRows — 경계", () => {
  it("lowCoverage · clipped 통과 · years 에 있지만 cells 가 없는 해는 12칸 null", () => {
    const p: YearPivot = {
      years: [2020, 2021],
      cells: { 2020: [{ value: 5, coveredDays: 3, totalDays: 12, lowCoverage: true, partial: "clipped" }, ...Array.from({ length: 11 }, () => null)] },
    };
    const rows = yoyLinkRows(p, "sleepScore");
    expect(rows[1].months[0]).toMatchObject({ lowCoverage: true, partial: "clipped", href: "/history/2020/01?metric=sleepScore" });
    expect(rows[0].year).toBe(2021);
    expect(rows[0].months.every((m) => m.value === null && m.href === null)).toBe(true);
    expect(hasAnyYoyValue(rows)).toBe(true);
    expect(hasAnyYoyValue(yoyLinkRows({ years: [2021], cells: {} }, "sleepScore"))).toBe(false);
  });
});

// 회귀: 사전 리뷰 major 1 — 링크 텍스트가 값뿐이면 Tab · 링크 목록에서 연 · 월 · 상태가 안 들린다
describe("yoyCellAnnouncement", () => {
  const cell = (partial: "current" | "clipped" | null, lowCoverage = false) => ({ month: 9, value: 1, partial, lowCoverage, href: "/history/2026/09" });
  it("연 · 월 + 합계형의 미완결 + 저커버리지", () => {
    expect(yoyCellAnnouncement(2026, cell(null), { isSum: true })).toBe("2026년 9월");
    expect(yoyCellAnnouncement(2026, cell("current"), { isSum: true })).toBe("2026년 9월 · 아직 끝나지 않음");
    expect(yoyCellAnnouncement(2020, cell("clipped", true), { isSum: true })).toBe("2020년 9월 · 기록 시작일이 걸림 · 기록 절반 미만");
  });
  it("평균형은 미완결을 말하지 않는다 (차트와 같은 규칙)", () => {
    expect(yoyCellAnnouncement(2026, cell("current"), { isSum: false })).toBe("2026년 9월");
  });
});
