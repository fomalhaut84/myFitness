// #395 (M15-3): /trends view model — 저커버리지 · 미완결 · YoY 피벗 · 계절성 규칙.
import { describe, expect, it } from "vitest";
import { getHistoryMetric } from "../metrics";
import type { SummaryBucket } from "../summary";
import { formatBucketLabel, isLowCoverage, pivotByYear, seasonality, summarizeSeries, toTrendPoints } from "../trends";

const ctx = { today: "2026-09-21", lowerBound: "2020-06-16" };
const km = getHistoryMetric("runningKm");
const sleep = getHistoryMetric("sleepScore");
const weight = getHistoryMetric("weight");
const vo2 = getHistoryMetric("vo2max");

function month(ym: string, id: string, value: number | null, coveredDays: number, totalDays = 30): SummaryBucket {
  const [y, m] = ym.split("-").map(Number);
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { key: ym, start: `${ym}-01`, end, totalDays, values: { [id]: { value, coveredDays } } };
}

describe("isLowCoverage", () => {
  it("기록이 절반 미만이면 true, 정확히 절반은 false", () => {
    expect(isLowCoverage(sleep, 14, 30)).toBe(true);
    expect(isLowCoverage(sleep, 15, 30)).toBe(false);
  });

  it("활동 지표 (0 이 진짜 0) 와 체중 (원래 드문 측정) 은 대상이 아니다", () => {
    expect(isLowCoverage(km, 2, 30)).toBe(false);
    expect(isLowCoverage(weight, 3, 30)).toBe(false);
  });

  it("기록 0일은 결측이지 저커버리지가 아니다", () => {
    expect(isLowCoverage(sleep, 0, 30)).toBe(false);
  });
});

describe("toTrendPoints", () => {
  const buckets = [
    month("2020-06", "runningKm", 40, 5, 15),
    month("2025-12", "runningKm", 120, 14, 31),
    month("2026-01", "runningKm", 130, 15, 31),
    month("2026-09", "runningKm", 60, 8, 21),
  ];
  const points = toTrendPoints(buckets, km, "month", ctx);

  it("미완결 = 하한이 걸친 첫 달 · 이번 달", () => {
    expect(points.map((p) => p.partial)).toEqual([true, false, false, true]);
  });

  it("연 경계 · 라벨 · /history 링크", () => {
    expect(points.map((p) => p.yearStart)).toEqual([false, true, true, false]);
    expect(points[2].label).toBe("1월");
    expect(points[2].href).toBe("/history/2026/01");
  });

  it("summarizeSeries: 합계형은 미완결 버킷을 최고/최저에서 제외", () => {
    const { best, worst } = summarizeSeries(points, km);
    expect(best?.key).toBe("2026-01");
    expect(worst?.key).toBe("2025-12"); // 2020-06(40) · 2026-09(60) 은 부분 합계라 제외
  });

  it("summarizeSeries: 결측 · 저커버리지 제외, 쓸 포인트가 없으면 null", () => {
    const s = toTrendPoints(
      [month("2025-01", "sleepScore", 60, 3), month("2025-02", "sleepScore", null, 0), month("2025-03", "sleepScore", 80, 28)],
      sleep,
      "month",
      ctx,
    );
    expect(summarizeSeries(s, sleep).worst?.key).toBe("2025-03");
    expect(summarizeSeries(s.slice(0, 2), sleep)).toEqual({ best: null, worst: null });
  });

  it("formatBucketLabel", () => {
    expect(formatBucketLabel("2024-03-11", "week")).toBe("3/11");
    expect(formatBucketLabel("2024-03", "month")).toBe("3월");
    expect(formatBucketLabel("2024", "year")).toBe("2024");
  });
});

describe("pivotByYear", () => {
  it("연도 × 12, 범위 밖 달은 null, 연도 오름차순", () => {
    const pivot = pivotByYear(
      [month("2025-12", "runningKm", 120, 14), month("2026-01", "runningKm", 130, 15), month("2026-09", "runningKm", 60, 8, 21)],
      km,
      ctx,
    );
    expect(pivot.years).toEqual([2025, 2026]);
    expect(pivot.cells[2025][11]?.value).toBe(120);
    expect(pivot.cells[2025][0]).toBeNull();
    expect(pivot.cells[2026][8]?.partial).toBe(true);
    expect(pivot.cells[2026][9]).toBeNull();
  });
});

describe("seasonality", () => {
  it("sum: 완결 월들의 월 합계 평균 — 미완결 월은 기여하지 않는다", () => {
    const pivot = pivotByYear(
      [month("2024-09", "runningKm", 150, 15), month("2025-09", "runningKm", 170, 16), month("2026-09", "runningKm", 60, 8, 21)],
      km,
      ctx,
    );
    const sep = seasonality(pivot, km)[8];
    expect(sep).toMatchObject({ month: 9, value: 160, years: 2 });
    expect(sep.points.map((p) => p.year)).toEqual([2024, 2025]);
  });

  it("avg: 기록 일수 가중 평균 (평균의 평균이 아니다) · 저커버리지 월 제외", () => {
    const pivot = pivotByYear(
      [month("2024-03", "sleepScore", 70, 30), month("2025-03", "sleepScore", 90, 15), month("2026-03", "sleepScore", 10, 2)],
      sleep,
      ctx,
    );
    // (70*30 + 90*15) / 45 = 76.67 → 77. 단순 평균이면 80, 저커버리지(10점) 포함이면 더 낮다
    expect(seasonality(pivot, sleep)[2]).toMatchObject({ value: 77, years: 2 });
  });

  it("max: 그 달의 역대 최고", () => {
    const pivot = pivotByYear([month("2024-05", "vo2max", 49.8, 20), month("2025-05", "vo2max", 51.2, 20)], vo2, ctx);
    expect(seasonality(pivot, vo2)[4].value).toBe(51.2);
  });

  it("기여한 해가 없는 달은 null", () => {
    const pivot = pivotByYear([month("2024-05", "vo2max", 49.8, 20)], vo2, ctx);
    expect(seasonality(pivot, vo2)[0]).toEqual({ month: 1, value: null, years: 0, points: [] });
  });
});
