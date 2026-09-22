// #396 (M15-4): 커버리지 띠 shape (순수).
import { describe, expect, it } from "vitest";
import { buildCoverageStrip, distinctDayRange, type CoverageRanges } from "../coverage";

const r = (oldest: string | null, newest: string | null, count: number) => ({ oldest, newest, count });
const ranges: CoverageRanges = {
  activities: { ...r("2020-06-19", "2026-09-21", 2332), running: r("2020-06-19", "2026-09-21", 1957) },
  daily_stats: r("2020-06-19", "2026-09-21", 2286),
  sleep: r("2020-06-20", "2026-09-21", 2241),
  heart_rate: r("2020-06-19", "2026-09-21", 2286),
  body_composition: r("2020-06-16", "2026-09-19", 372),
  blood_pressure: r(null, null, 0),
  fitness_metrics: r("2020-06-26", "2026-09-20", 2000),
  hrv: r("2026-04-20", "2026-09-21", 151),
  food_log: r("2019-12-01", "2026-09-21", 118),
};
const ctx = { lowerBound: "2020-06-16", today: "2026-09-21" };

describe("buildCoverageStrip", () => {
  it("소스 8개 · 하한 → 오늘 축 위 퍼센트 · 활동은 러닝 건수 병기", () => {
    const strip = buildCoverageStrip(ranges, ctx);
    expect(strip.rows.map((row) => row.id)).toEqual(["activities", "daily_stats", "sleep", "body_composition", "fitness_metrics", "hrv", "blood_pressure", "food_log"]);
    const activities = strip.rows[0];
    expect(activities.note).toBe("러닝 1,957건");
    expect(activities.startPct).toBeCloseTo((3 / 2288) * 100, 5);
    expect(activities.endPct).toBe(100);
    const hrv = strip.rows.find((row) => row.id === "hrv");
    expect(hrv?.startPct).toBeGreaterThan(90);
  });

  it("기록 없는 소스는 퍼센트 null · 하한 이전 기록은 0 으로 클램프", () => {
    const strip = buildCoverageStrip(ranges, ctx);
    expect(strip.rows.find((row) => row.id === "blood_pressure")).toMatchObject({ count: 0, startPct: null, endPct: null });
    expect(strip.rows.find((row) => row.id === "food_log")?.startPct).toBe(0);
  });

  it("데이터가 하루뿐이면 (span 0) 0 으로", () => {
    const strip = buildCoverageStrip(ranges, { lowerBound: "2026-09-21", today: "2026-09-21" });
    expect(strip.rows[0].startPct).toBe(0);
  });
});

// 회귀: PR #412 Codex P2 — 식단은 하루 여러 끼라 행 수가 일수처럼 읽혔다
describe("distinctDayRange", () => {
  it("같은 KST 날의 여러 행은 하루로 센다 · UTC 경계 (KST 자정 전후) 는 KST 기준", () => {
    const range = distinctDayRange([
      new Date("2026-05-02T00:30:00+09:00"),
      new Date("2026-05-02T12:00:00+09:00"),
      new Date("2026-05-02T23:50:00+09:00"),
      new Date("2026-05-03T00:10:00+09:00"), // UTC 로는 5/2 15:10 — KST 로 5/3
    ]);
    expect(range).toEqual({ oldest: "2026-05-02", newest: "2026-05-03", count: 2 });
    expect(distinctDayRange([])).toEqual({ oldest: null, newest: null, count: 0 });
  });
});
