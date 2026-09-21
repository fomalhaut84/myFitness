// #394 (M15-2): 달력 그리드 계산 — 윤년 · 첫 요일 · 연 경계.
import { describe, expect, it } from "vitest";
import { addMonthsYm, daysInYm, dayOfWeekYmd, isValidYm, monthCells } from "../month-cells";

describe("month-cells", () => {
  it("윤년 2024-02 = 29일, 평년 2023-02 = 28일", () => {
    expect(daysInYm("2024-02")).toBe(29);
    expect(daysInYm("2023-02")).toBe(28);
    expect(daysInYm("2024-12")).toBe(31);
  });

  it("첫 요일 오프셋 (일요일 시작 그리드)", () => {
    // 2024-03-01 = 금요일 → 빈 칸 5, 2024-09-01 = 일요일 → 0
    expect(monthCells("2024-03").leadingBlanks).toBe(5);
    expect(monthCells("2024-09").leadingBlanks).toBe(0);
    expect(dayOfWeekYmd("2026-09-21")).toBe(1); // 월요일
  });

  it("days 는 그 달 전체 ymd 오름차순", () => {
    const { days } = monthCells("2024-02");
    expect(days).toHaveLength(29);
    expect(days[0]).toBe("2024-02-01");
    expect(days[28]).toBe("2024-02-29");
  });

  it("addMonthsYm 은 연 경계를 넘는다", () => {
    expect(addMonthsYm("2024-12", 1)).toBe("2025-01");
    expect(addMonthsYm("2024-01", -1)).toBe("2023-12");
    expect(addMonthsYm("2024-03", 0)).toBe("2024-03");
    expect(addMonthsYm("2024-03", -15)).toBe("2022-12");
  });

  it("isValidYm", () => {
    expect(isValidYm("2024-03")).toBe(true);
    expect(isValidYm("2024-13")).toBe(false);
    expect(isValidYm("2024-3")).toBe(false);
  });
});
