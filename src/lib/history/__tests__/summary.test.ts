// #393 (M15-1) 회귀 — 사전 리뷰 major 1: 버킷은 달력 전체인데 조회를 from/to 로 하면 첫/끝 버킷이 부분 합계.
// prisma 는 로드하지 않는다 — loader 를 주입하고 하한 모듈은 mock.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import { getHistorySummary, type DailyPointsLoader } from "../summary";

const ctx = { lowerBound: "2020-06-16", today: "2026-09-18" };

describe("getHistorySummary — 조회 범위 = 버킷 스팬", () => {
  it("month · from/to 가 달 중간이어도 3월 전체를 조회해 합산한다", async () => {
    const calls: Array<[string, string]> = [];
    const loader: DailyPointsLoader = async (from, to) => {
      calls.push([from, to]);
      return {
        runningKm: [
          { ymd: "2024-03-02", value: 10 }, // from(03-15) 이전 — 달력 전체 버킷이면 포함돼야 한다
          { ymd: "2024-03-20", value: 5 },
          { ymd: "2024-05-25", value: 7 }, // to(05-20) 이후 — 5월 버킷에 포함
        ],
      };
    };
    const s = await getHistorySummary(
      { granularity: "month", from: "2024-03-15", to: "2024-05-20", metrics: ["runningKm"], clampedFrom: false, clampedTo: false },
      ctx,
      loader,
    );
    expect(calls).toEqual([["2024-03-01", "2024-05-31"]]);
    expect(s.buckets.map((b) => b.key)).toEqual(["2024-03", "2024-04", "2024-05"]);
    expect(s.buckets[0].values.runningKm).toEqual({ value: 15, coveredDays: 2 });
    expect(s.buckets[2].values.runningKm).toEqual({ value: 7, coveredDays: 1 });
    expect(s.buckets[0].totalDays).toBe(31);
    expect(s.metrics.runningKm?.missingAsZero).toBe(true);
  });

  it("빈 버킷 목록이면 loader 를 호출하지 않는다", async () => {
    const loader = vi.fn<DailyPointsLoader>(async () => ({}));
    const s = await getHistorySummary(
      { granularity: "day", from: "2024-03-02", to: "2024-03-01", metrics: ["steps"], clampedFrom: false, clampedTo: false },
      ctx,
      loader,
    );
    expect(loader).not.toHaveBeenCalled();
    expect(s.buckets).toEqual([]);
  });
});
