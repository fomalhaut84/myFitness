// #425 E: 회복이 빨라졌나 — 연도별 2분 HRR 중앙값.
import { describe, expect, it } from "vitest";
import { MIN_YEAR_RUNS, recoveryByYear, recoveryDelta, recoveryPoints, yearFraction } from "../recovery";
import { run } from "./fixtures";

const pts = (year: number, values: readonly number[]) => values.map((v, i) => ({ id: `${year}-${i}`, ymd: `${year}-03-0${(i % 9) + 1}`, year, hrr2: v, distanceM: 10_000, race: false }));

describe("recoveryPoints", () => {
  it("hrr2 있는 러닝만 · 거리 없는 트레드밀도 포함 · 레이스 플래그 유지", () => {
    const runs = [
      run("2025-01-01", { id: "a", hrr2: 16 }),
      run("2025-01-02", { id: "b", hrr2: null }),
      run("2025-01-03", { id: "c", hrr2: -3, distanceM: null, race: true }),
    ];
    expect(recoveryPoints(runs).map((p) => [p.id, p.hrr2, p.distanceM, p.race])).toEqual([
      ["a", 16, 10_000, false],
      ["c", -3, null, true],
    ]);
  });
});

describe("recoveryByYear", () => {
  it("연도 오름차순 · 중앙값 (홀수 · 짝수) · 5건 미만 null · years 열 유지 (n=0)", () => {
    expect(MIN_YEAR_RUNS).toBe(5);
    const points = [...pts(2024, [10, 30, 20, 40, 50]), ...pts(2022, [12, 18, 14, 16, 20, 22]), ...pts(2023, [99, 98])];
    expect(recoveryByYear(points, [2022, 2023, 2024, 2025])).toEqual([
      { year: 2022, n: 6, medianHrr2: 17 },
      { year: 2023, n: 2, medianHrr2: null },
      { year: 2024, n: 5, medianHrr2: 30 },
      { year: 2025, n: 0, medianHrr2: null },
    ]);
  });

  it("years 를 주지 않으면 포인트가 있는 해만", () => {
    expect(recoveryByYear(pts(2021, [1, 2, 3, 4, 5])).map((y) => y.year)).toEqual([2021]);
  });
});

describe("recoveryDelta", () => {
  it("첫 유효 해 vs 마지막 유효 해 — 사이의 null 해는 건너뛴다", () => {
    const years = [
      { year: 2020, n: 3, medianHrr2: null },
      { year: 2021, n: 9, medianHrr2: 14 },
      { year: 2023, n: 2, medianHrr2: null },
      { year: 2025, n: 9, medianHrr2: 20.5 },
    ];
    expect(recoveryDelta(years)).toEqual({ firstYear: 2021, lastYear: 2025, from: 14, to: 20.5, delta: 6.5 });
  });

  it("유효 해가 둘 미만이면 null", () => {
    expect(recoveryDelta([{ year: 2025, n: 9, medianHrr2: 20 }])).toBeNull();
    expect(recoveryDelta([])).toBeNull();
  });
});

describe("yearFraction", () => {
  it("1월 1일 = year.0 · 12월 31일 < year+1 · 윤년 · 문자열에서만 계산", () => {
    expect(yearFraction("2025-01-01")).toBe(2025);
    expect(yearFraction("2025-12-31")).toBeCloseTo(2025 + 364 / 365, 6);
    expect(yearFraction("2024-12-31")).toBeCloseTo(2024 + 365 / 366, 6);
    expect(yearFraction("2024-07-01")).toBeCloseTo(2024 + 182 / 366, 6);
  });
});
