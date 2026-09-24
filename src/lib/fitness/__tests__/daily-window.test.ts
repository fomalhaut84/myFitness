// #455 F3: 일별 창 합계 — 강도 분 (WHO 150분/주) · 층수. null 은 0 이 아니라 제외.
import { describe, expect, it } from "vitest";
import { intensityComponents, summarizeDailyWindow, weightedIntensityMin } from "../daily-window";

describe("summarizeDailyWindow", () => {
  it("합계 · 값 있는 날 수 · null 은 제외", () => {
    const s = summarizeDailyWindow([
      { intensityMin: 40, floorsClimbed: 10 },
      { intensityMin: null, floorsClimbed: 5 },
      { intensityMin: 0, floorsClimbed: null },
      { intensityMin: 75, floorsClimbed: 12 },
    ]);
    expect(s).toMatchObject({ rowCount: 4, intensityMinTotal: 115, daysWithIntensity: 3, floorsClimbedTotal: 27 });
    // rawData 없음 → 가중 합 없음
    expect(s).toMatchObject({ weightedIntensityMinTotal: null, moderateMinTotal: null, vigorousMinTotal: null, daysWithComponents: 0 });
  });

  it("전부 null 이면 합계 null · 빈 창", () => {
    expect(summarizeDailyWindow([{ intensityMin: null, floorsClimbed: null }])).toMatchObject({ rowCount: 1, intensityMinTotal: null, daysWithIntensity: 0, floorsClimbedTotal: null });
    expect(summarizeDailyWindow([])).toMatchObject({ rowCount: 0, intensityMinTotal: null, daysWithIntensity: 0, floorsClimbedTotal: null, weightedIntensityMinTotal: null });
  });

  // 회귀: PR #462 Codex P1 — intensityMin 은 moderate + vigorous 단순합이라 150 과 비교하면 고강도 주가 미달로 나온다
  it("rawData 의 성분으로 가중 합 (moderate + 2×vigorous) 을 따로 낸다", () => {
    const s = summarizeDailyWindow([
      { intensityMin: 50, floorsClimbed: null, rawData: { moderateIntensityMinutes: 20, vigorousIntensityMinutes: 30 } }, // 20 + 60 = 80
      { intensityMin: 30, floorsClimbed: null, rawData: { moderateIntensityMinutes: "30", vigorousIntensityMinutes: null } }, // 30
      { intensityMin: 10, floorsClimbed: null, rawData: {} }, // 성분 없음 — 비가중 합에만
      { intensityMin: null, floorsClimbed: null },
    ]);
    expect(s.intensityMinTotal).toBe(90);
    expect(s.daysWithIntensity).toBe(3);
    expect(s.weightedIntensityMinTotal).toBe(110);
    expect(s.moderateMinTotal).toBe(50);
    expect(s.vigorousMinTotal).toBe(30);
    expect(s.daysWithComponents).toBe(2);
  });
});

describe("intensityComponents / weightedIntensityMin", () => {
  it("둘 다 없으면 null · 한쪽만 있으면 없는 쪽 0 · 문자열 숫자 허용 · 형태 아님 null", () => {
    expect(intensityComponents({ moderateIntensityMinutes: 12, vigorousIntensityMinutes: 4 })).toEqual({ moderate: 12, vigorous: 4 });
    expect(intensityComponents({ vigorousIntensityMinutes: "7" })).toEqual({ moderate: 0, vigorous: 7 });
    expect(intensityComponents({ moderateIntensityMinutes: null, vigorousIntensityMinutes: undefined })).toBeNull();
    expect(intensityComponents(null)).toBeNull();
    expect(intensityComponents("x")).toBeNull();
    expect(weightedIntensityMin({ moderate: 12, vigorous: 4 })).toBe(20);
  });
});
