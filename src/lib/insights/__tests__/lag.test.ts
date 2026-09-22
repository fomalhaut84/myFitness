// #397 D: 주간 km → 다음 주 RHR.
import { describe, expect, it } from "vitest";
import { addDaysYmd } from "@/lib/history/buckets";
import type { SummaryBucket } from "@/lib/history/summary";
import { kmBandTable, lagCorrelations, lagPairs } from "../lag";
import { ctx } from "./fixtures";

function week(start: string, km: number | null, rhr: number | null, rhrDays = 7): SummaryBucket {
  return {
    key: start,
    start,
    end: addDaysYmd(start, 7),
    totalDays: 7,
    values: { runningKm: { value: km, coveredDays: km ? 3 : 0 }, restingHR: { value: rhr, coveredDays: rhr === null ? 0 : rhrDays } },
  };
}

// 2026-08-24 · 08-31 · 09-07 · 09-14 (오늘 09-21 이 속한 주는 09-21 ~ — 미완결)
const weeks = [week("2026-08-03", 10, 50), week("2026-08-10", 20, 51), week("2026-08-17", 30, 52, 3), week("2026-08-24", 40, 53), week("2026-08-31", 50, null), week("2026-09-07", 60, 55), week("2026-09-14", 70, 56), week("2026-09-21", 5, 48)];

describe("lagPairs", () => {
  it("지연 1: 다음 주 RHR · 저커버리지 (3/7) · 결측 · 미완결 주 제외", () => {
    const pairs = lagPairs(weeks, 1, ctx);
    expect(pairs.map((p) => [p.weekKey, p.km, p.rhr])).toEqual([
      ["2026-08-03", 10, 51],
      // 08-10 → 08-17 은 RHR 저커버리지 (3/7) 로 제외. 08-17 자체는 km 쪽이라 남는다
      ["2026-08-17", 30, 53],
      // 08-24 → 08-31 은 RHR 결측
      ["2026-08-31", 50, 55],
      ["2026-09-07", 60, 56],
      // 09-14 → 09-21 은 미완결 주
    ]);
  });

  it("지연 0 은 같은 주 · 지연 2", () => {
    expect(lagPairs(weeks, 0, ctx).map((p) => p.weekKey)).toEqual(["2026-08-03", "2026-08-10", "2026-08-24", "2026-09-07", "2026-09-14"]);
    expect(lagPairs(weeks, 2, ctx).map((p) => [p.km, p.rhr])).toEqual([
      [20, 53],
      [40, 55],
      [50, 56],
    ]);
  });

  it("연도 = 기준 주 시작 연도", () => {
    expect(lagPairs([week("2025-12-29", 10, 50), week("2026-01-05", 10, 51)], 1, ctx)[0].year).toBe(2025);
  });
});

describe("lagCorrelations · kmBandTable", () => {
  it("r 은 쌍 3개 이상일 때만", () => {
    const rs = lagCorrelations(weeks, [0, 1, 2], ctx);
    expect(rs.map((x) => x.lag)).toEqual([0, 1, 2]);
    expect(rs[0].n).toBe(5);
    expect(rs[0].r).toBeCloseTo(1, 5);
    expect(rs[1].n).toBe(4);
    expect(rs[1].r).toBeGreaterThan(0.95);
    expect(lagCorrelations(weeks.slice(0, 3), [1], ctx)[0]).toMatchObject({ n: 1, r: null });
  });

  it("km 구간 표 — 0~20 · 20~35 · 35~50 · 50+ (상한 exclusive) · 빈 구간 null", () => {
    const table = kmBandTable(lagPairs(weeks, 0, ctx));
    expect(table.map((b) => [b.label, b.n, b.avgRhr])).toEqual([
      ["0~20", 1, 50],
      ["20~35", 1, 51],
      ["35~50", 1, 53],
      ["50+", 2, 55.5],
    ]);
  });
});
