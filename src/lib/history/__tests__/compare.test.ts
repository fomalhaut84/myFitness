// #395 (M15-3): 기간 비교 표 행.
import { describe, expect, it } from "vitest";
import { buildCompareRows, compareMetricIds, needsPerMonth } from "../compare";

const peak = {
  months: 5,
  totalDays: 152, // 2023-11-01 ~ 2024-03-31
  truncated: false,
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
  totalDays: 92,
  truncated: false,
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
    expect(by.runningKm.a.perMonthText).toBe("237.34"); // 1185.22 / (152일 / 30.4375)
    expect(by.runningKm.b.perMonthText).toBe("127.60");
    expect(by.restingHR.a.perMonthText).toBeNull();
    const same = buildCompareRows(peak, { ...recent, months: 5 }, "runningKm");
    expect(same[0].a.perMonthText).toBeNull();
  });

  // 회귀: #395 사전 리뷰 info 4 — 이번 달이 낀 구간은 오늘까지만 조회된다. 명목 월 수(3)로 나누면 월평균이 과소 계산된다.
  it("월평균은 명목 월 수가 아니라 실제 조회 일수 기준", () => {
    const partialMonth = buildCompareRows(peak, { ...recent, months: 3, totalDays: 82 }, "runningKm"); // 7/1 ~ 9/21
    expect(partialMonth[0].b.perMonthText).toBe("143.16"); // 385.69 / (82 / 30.4375). 3 으로 나누면 128.56
  });

  // 회귀: PR #407 Codex P2 — 7~9월 2025 (92일) vs 7~9월 2026 오늘까지 (83일) 은 명목 월 수가 같아 월평균이 빠지고,
  // 끝나지 않은 구간의 합계가 그대로 비교돼 낮아 보였다.
  it("월 수가 같아도 한쪽이 잘린 구간이면 월평균 병기, 자연스러운 일수 차이 (2월 vs 3월) 는 대상 아님", () => {
    const lastYear = { ...recent, totalDays: 92, truncated: false };
    const thisYear = { ...recent, totalDays: 83, truncated: true };
    expect(buildCompareRows(lastYear, thisYear, "runningKm")[0].b.perMonthText).not.toBeNull();
    expect(needsPerMonth(lastYear, thisYear)).toBe(true);
    const feb = { ...recent, months: 1, totalDays: 28 };
    const mar = { ...recent, months: 1, totalDays: 31 };
    expect(needsPerMonth(feb, mar)).toBe(false);
  });

  it("반올림하면 0 인 차이는 부호 없이", () => {
    const a = { ...peak, values: { ...peak.values, vo2max: { value: 50.34, coveredDays: 10, last: 50 } } };
    const b = { ...recent, values: { ...recent.values, vo2max: { value: 50.3, coveredDays: 10, last: 50 } } };
    expect(buildCompareRows(a, b, "runningKm").find((r) => r.key === "vo2max")?.diffText).toBe("0.0");
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
