// #394 (M15-2): 달력 그리드 계산 — 윤년 · 첫 요일 · 연 경계.
import { describe, expect, it } from "vitest";
import { WEEKDAY_LABELS, addMonthsYm, daysInYm, isValidYm, monthCells, weekdayIndexMon } from "../month-cells";

describe("month-cells", () => {
  it("윤년 2024-02 = 29일, 평년 2023-02 = 28일", () => {
    expect(daysInYm("2024-02")).toBe(29);
    expect(daysInYm("2023-02")).toBe(28);
    expect(daysInYm("2024-12")).toBe(31);
  });

  // #445: 월요일 시작 그리드 (사용자 요청 2026-09-23). 이전 기대값 (일요일 시작: 2024-03 → 5 · 2024-09 → 0) 은 폐기
  it("첫 요일 오프셋 (월요일 시작 그리드)", () => {
    // 2024-03-01 = 금요일 → 빈 칸 4, 2024-09-01 = 일요일 → 6, 2026-06-01 = 월요일 → 0, 2026-09-01 = 화요일 → 1
    expect(monthCells("2024-03").leadingBlanks).toBe(4);
    expect(monthCells("2024-09").leadingBlanks).toBe(6);
    expect(monthCells("2026-06").leadingBlanks).toBe(0);
    expect(monthCells("2026-09").leadingBlanks).toBe(1);
  });

  it("weekdayIndexMon — 0 = 월 … 6 = 일 (ymd 문자열 · 서버 TZ 무관)", () => {
    expect(weekdayIndexMon("2026-09-21")).toBe(0); // 월요일
    expect(weekdayIndexMon("2026-09-27")).toBe(6); // 일요일
    expect(weekdayIndexMon("2026-09-26")).toBe(5); // 토요일
  });

  it("WEEKDAY_LABELS 는 월 → 일 7개, 그리드 열 순서와 같다", () => {
    expect(WEEKDAY_LABELS).toEqual(["월", "화", "수", "목", "금", "토", "일"]);
    // 2026-09-01 (화) 은 leadingBlanks 1 → 두 번째 열 = "화"
    expect(WEEKDAY_LABELS[monthCells("2026-09").leadingBlanks]).toBe("화");
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
