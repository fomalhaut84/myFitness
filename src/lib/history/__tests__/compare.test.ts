// #395 (M15-3): 기간 비교 표 행.
import { describe, expect, it } from "vitest";
import { buildCompareRows, compareMetricIds } from "../compare";

const peak = {
  months: 5,
  values: {
    runningKm: { value: 1185.22, coveredDays: 92 },
    runningCount: { value: 92, coveredDays: 92 },
    runningDurationSec: { value: 1185.22 * 297, coveredDays: 92 },
    vo2max: { value: 52.3, coveredDays: 120, last: 52.0 },
    restingHR: { value: 49, coveredDays: 150 },
    sleepScore: { value: 76, coveredDays: 150 },
    weight: { value: 70.6, coveredDays: 30, last: 70.1 },
  },
};
const recent = {
  months: 3,
  values: {
    runningKm: { value: 385.69, coveredDays: 41 },
    runningCount: { value: 41, coveredDays: 41 },
    runningDurationSec: { value: 385.69 * 347, coveredDays: 41 },
    vo2max: { value: 50.3, coveredDays: 80, last: 50.1 },
    restingHR: { value: 52, coveredDays: 90 },
    sleepScore: { value: 76, coveredDays: 90 },
    weight: { value: 72.2, coveredDays: 20, last: 72.6 },
    hrv: { value: 57.8, coveredDays: 88 },
  },
};

describe("buildCompareRows", () => {
  const rows = buildCompareRows(peak, recent, "runningKm");
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));

  it("KPI 7행 · 선택 지표 표시", () => {
    expect(rows.map((r) => r.key)).toEqual(["runningKm", "runningCount", "pace", "vo2max", "restingHR", "sleepScore", "weight"]);
    expect(by.runningKm.selected).toBe(true);
    expect(by.weight.selected).toBe(false);
  });

  it("차이 = B − A, 부호 + 크기 (단위는 행 제목)", () => {
    expect(by.runningKm.diffText).toBe("−799.53");
    expect(by.restingHR.diffText).toBe("+3");
    expect(by.sleepScore.diffText).toBe("0");
    expect(by.vo2max.diffText).toBe("−2.0");
  });

  it("체중은 평균이 아니라 기간 말 값", () => {
    expect(by.weight.a.text).toBe("70.1");
    expect(by.weight.b.text).toBe("72.6");
    expect(by.weight.diffText).toBe("+2.5");
  });

  it("페이스는 시간 합 / 거리 합, 차이는 초", () => {
    expect(by.pace.a.text).toBe(`4'57"`);
    expect(by.pace.b.text).toBe(`5'47"`);
    expect(by.pace.diffText).toBe("+50초");
    expect(by.pace.unit).toBe("/km");
  });

  it("구간 길이가 다르면 합계형에만 월평균 병기", () => {
    expect(by.runningKm.a.perMonthText).toBe("237.04");
    expect(by.runningKm.b.perMonthText).toBe("128.56");
    expect(by.restingHR.a.perMonthText).toBeNull();
    const same = buildCompareRows(peak, { ...recent, months: 5 }, "runningKm");
    expect(same[0].a.perMonthText).toBeNull();
  });

  it("KPI 에 없는 선택 지표는 맨 아래 행, 한쪽이 기록 없음이면 차이도 없음", () => {
    const withHrv = buildCompareRows(peak, recent, "hrv");
    const last = withHrv[withHrv.length - 1];
    expect(last).toMatchObject({ key: "hrv", selected: true, unit: "ms", diffText: null });
    expect(last.a.text).toBeNull();
    expect(last.b.text).toBe("57.8");
  });

  it("compareMetricIds 는 KPI 재료 + 선택 지표 (중복 없음)", () => {
    expect(compareMetricIds("hrv")).toContain("runningDurationSec");
    expect(compareMetricIds("hrv")).toContain("hrv");
    expect(compareMetricIds("weight").filter((id) => id === "weight")).toHaveLength(1);
  });
});
