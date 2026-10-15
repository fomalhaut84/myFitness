import { describe, expect, it } from "vitest";
import { aggregateBpByDay, classifyBp, pickDailyScale } from "../aggregate";
import type { OmronBpReading, OmronScaleReading } from "../parse";
import { kst } from "./fixtures";

function bpReading(at: string, systolic: number, diastolic: number, pulse: number | null): OmronBpReading {
  return { measuredAt: new Date(kst(at)), systolic, diastolic, pulse, values: {} };
}

function scaleReading(at: string, weightKg: number): OmronScaleReading {
  return {
    measuredAt: new Date(kst(at)),
    weightKg,
    bmi: null,
    bodyFatPct: null,
    skeletalMusclePct: null,
    skeletalMuscleKg: null,
    visceralFatLevel: null,
    basalMetabolism: null,
    bodyAge: null,
    values: {},
  };
}

describe("classifyBp — AHA 2017 (Garmin category 와 같은 체계)", () => {
  it.each([
    [119, 79, "NORMAL"],
    [120, 79, "HIGH_NORMAL"],
    [129, 79, "HIGH_NORMAL"],
    [130, 70, "STAGE_1_HIGH"],
    [122, 82, "STAGE_1_HIGH"], // 이완기 80–89 단독 (프로덕션 Garmin 행 대조)
    [130, 89, "STAGE_1_HIGH"],
    [134, 90, "STAGE_2_HIGH"], // 이완기 ≥ 90
    [140, 70, "STAGE_2_HIGH"],
  ] as const)("%i/%i → %s", (sys, dia, expected) => {
    expect(classifyBp(sys, dia)).toBe(expected);
  });
});

describe("aggregateBpByDay", () => {
  it("KST 날짜별 high/low · 평균 맥박 · 횟수 · 최고 단계 category", () => {
    const days = aggregateBpByDay([
      bpReading("2026-10-01 07:00", 128, 85, 60),
      bpReading("2026-10-01 07:05", 134, 91, 62),
      bpReading("2026-10-01 21:00", 118, 76, null),
    ]);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({
      ymd: "2026-10-01",
      highSystolic: 134,
      lowSystolic: 118,
      highDiastolic: 91,
      lowDiastolic: 76,
      avgPulse: 61,
      measureCount: 3,
      category: "STAGE_2_HIGH",
    });
    expect(days[0].date.toISOString()).toBe("2026-09-30T15:00:00.000Z");
  });

  it("KST 00:30 측정은 그 KST 날짜 (UTC 전날) 에 속한다", () => {
    const days = aggregateBpByDay([bpReading("2026-10-02 00:30", 120, 80, 60)]);
    expect(days.map((d) => d.ymd)).toEqual(["2026-10-02"]);
  });

  it("개별 측정은 시간순으로 남고 맥박이 모두 없으면 avgPulse null", () => {
    const [day] = aggregateBpByDay([
      bpReading("2026-10-01 09:00", 120, 80, null),
      bpReading("2026-10-01 07:00", 125, 82, null),
    ]);
    expect(day.avgPulse).toBeNull();
    expect(day.measurements.map((m) => m.systolic)).toEqual([125, 120]);
    expect(day.measurements[0]).toMatchObject({ category: "STAGE_1_HIGH", measuredAt: expect.any(String) });
  });

  it("날짜 오름차순으로 돌려준다", () => {
    const days = aggregateBpByDay([
      bpReading("2026-10-03 07:00", 120, 80, 60),
      bpReading("2026-10-01 07:00", 120, 80, 60),
    ]);
    expect(days.map((d) => d.ymd)).toEqual(["2026-10-01", "2026-10-03"]);
  });
});

describe("pickDailyScale — 하루 대표 = 가장 이른 측정 (2026-10-15 사용자 결정)", () => {
  it("같은 KST 날짜의 가장 이른 측정을 대표로, 전체는 시간순 보존", () => {
    const days = pickDailyScale([
      scaleReading("2026-10-01 08:00", 89.2),
      scaleReading("2026-10-01 00:40", 89.0),
      scaleReading("2026-10-01 23:10", 89.5),
    ]);
    expect(days).toHaveLength(1);
    expect(days[0].representative.weightKg).toBe(89.0);
    expect(days[0].all.map((r) => r.weightKg)).toEqual([89.0, 89.2, 89.5]);
    expect(days[0].date.toISOString()).toBe("2026-09-30T15:00:00.000Z");
  });

  it("KST 자정 직후 측정은 새 날짜의 대표가 된다", () => {
    const days = pickDailyScale([
      scaleReading("2026-10-01 23:50", 89.4),
      scaleReading("2026-10-02 00:20", 89.1),
    ]);
    expect(days.map((d) => [d.ymd, d.representative.weightKg])).toEqual([
      ["2026-10-01", 89.4],
      ["2026-10-02", 89.1],
    ]);
  });
});
