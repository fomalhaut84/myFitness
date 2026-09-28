// #395 (M15-3): 임의 구간 한 덩어리 롤업.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import { getHistoryRangeTotals, rangeTotalsFromPoints } from "../range-totals";

const range = { from: "2024-01-01", to: "2024-02-29" };

describe("rangeTotalsFromPoints", () => {
  it("평균은 일별 포인트에서 직접 — 월 평균의 평균과 다르다", () => {
    const points = {
      sleepScore: [
        { ymd: "2024-01-10", value: 60 },
        { ymd: "2024-02-01", value: 90 },
        { ymd: "2024-02-02", value: 90 },
        { ymd: "2024-02-03", value: 90 },
      ],
    };
    const totals = rangeTotalsFromPoints(points, range, ["sleepScore"]);
    // (60 + 90*3) / 4 = 82.5 → 83. 월 평균(60, 90)의 평균이면 75
    expect(totals.values.sleepScore).toMatchObject({ value: 83, coveredDays: 4, min: 60, max: 90 });
    expect(totals.totalDays).toBe(60);
  });

  it("합계 · last · 범위 밖 포인트 제외", () => {
    const totals = rangeTotalsFromPoints(
      {
        runningKm: [
          { ymd: "2023-12-31", value: 99 },
          { ymd: "2024-01-05", value: 10.5 },
          { ymd: "2024-02-29", value: 5.25 },
        ],
        weight: [
          { ymd: "2024-01-05", value: 72 },
          { ymd: "2024-02-20", value: 70.4 },
        ],
      },
      range,
      ["runningKm", "weight"],
    );
    expect(totals.values.runningKm?.value).toBe(15.75);
    expect(totals.values.weight).toMatchObject({ value: 71.2, last: 70.4 });
  });

  it("빈 구간: 활동 지표는 0, 그 외는 null", () => {
    const totals = rangeTotalsFromPoints({}, range, ["runningKm", "sleepScore"]);
    expect(totals.values.runningKm?.value).toBe(0);
    expect(totals.values.sleepScore?.value).toBeNull();
  });
});

describe("getHistoryRangeTotals", () => {
  it("loader 를 구간 그대로 한 번 호출", async () => {
    const loader = vi.fn(async () => ({ runningKm: [{ ymd: "2024-01-05", value: 8 }] }));
    const totals = await getHistoryRangeTotals(range, ["runningKm"], loader);
    expect(loader).toHaveBeenCalledWith("2024-01-01", "2024-02-29", ["runningKm"]);
    expect(totals.values.runningKm?.value).toBe(8);
  });

  it("역순 구간은 조회하지 않는다", async () => {
    const loader = vi.fn(async () => ({}));
    const totals = await getHistoryRangeTotals({ from: "2024-03-01", to: "2024-02-01" }, ["runningKm"], loader);
    expect(loader).not.toHaveBeenCalled();
    expect(totals.totalDays).toBe(0);
  });
});
