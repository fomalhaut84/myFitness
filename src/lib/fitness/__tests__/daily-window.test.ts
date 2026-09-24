// #455 F3: 일별 창 합계 — 강도 분 (WHO 150분/주) · 층수. null 은 0 이 아니라 제외.
import { describe, expect, it } from "vitest";
import { summarizeDailyWindow } from "../daily-window";

describe("summarizeDailyWindow", () => {
  it("합계 · 값 있는 날 수 · null 은 제외", () => {
    const s = summarizeDailyWindow([
      { intensityMin: 40, floorsClimbed: 10 },
      { intensityMin: null, floorsClimbed: 5 },
      { intensityMin: 0, floorsClimbed: null },
      { intensityMin: 75, floorsClimbed: 12 },
    ]);
    expect(s).toEqual({ rowCount: 4, intensityMinTotal: 115, daysWithIntensity: 3, floorsClimbedTotal: 27 });
  });

  it("전부 null 이면 합계 null · 빈 창", () => {
    expect(summarizeDailyWindow([{ intensityMin: null, floorsClimbed: null }])).toEqual({ rowCount: 1, intensityMinTotal: null, daysWithIntensity: 0, floorsClimbedTotal: null });
    expect(summarizeDailyWindow([])).toEqual({ rowCount: 0, intensityMinTotal: null, daysWithIntensity: 0, floorsClimbedTotal: null });
  });
});
