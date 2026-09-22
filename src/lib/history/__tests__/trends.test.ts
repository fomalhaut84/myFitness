// #395 (M15-3): /trends view model — 저커버리지 · 미완결 · YoY 피벗 · 계절성 규칙.
import { describe, expect, it } from "vitest";
import { getHistoryMetric } from "../metrics";
import type { SummaryBucket } from "../summary";
import {
  buildYoyRows,
  formatBucketLabel,
  isLowCoverage,
  partialReason,
  pivotByYear,
  seasonality,
  summarizeSeries,
  toTrendPoints,
  bucketHref,
} from "../trends";

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

  it("활동 지표 (0 이 진짜 0) 와 sparse 지표 (체중 · 젖산역치 페이스) 는 대상이 아니다", () => {
    expect(isLowCoverage(km, 2, 30)).toBe(false);
    expect(isLowCoverage(weight, 3, 30)).toBe(false);
    expect(isLowCoverage(getHistoryMetric("ltPace"), 1, 30)).toBe(false);
  });

  // 회귀: PR #407 Codex P2 — 젖산역치 페이스는 Garmin 감지일에만 기록돼 월 1~2일이 정상. 저커버리지로 걸러지면
  // YoY · 계절성이 통째로 비고 최고/최저 판독값도 빈다.
  it("감지일에만 기록되는 ltPace 도 YoY · 계절성 · 최고/최저에 남는다", () => {
    const lt = getHistoryMetric("ltPace");
    const buckets = [month("2025-05", "ltPace", 330, 1), month("2026-05", "ltPace", 321, 2)];
    const pivot = pivotByYear(buckets, lt, ctx);
    expect(buildYoyRows(pivot, lt)[4]).toMatchObject({ y2025: 330, y2026: 321 });
    expect(seasonality(pivot, lt)[4]).toMatchObject({ value: 326, years: 2 });
    expect(summarizeSeries(toTrendPoints(buckets, lt, "month", ctx), lt).best?.key).toBe("2025-05");
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

  // 회귀: #395 사전 리뷰 major 3 — 6년 전 달 (기록 시작일이 걸린 첫 달) 이 "아직 끝나지 않은 월" 로 표시됐다.
  it("미완결 사유를 구분한다: 기록 시작일이 걸린 첫 달 = clipped, 이번 달 = current", () => {
    expect(points.map((p) => p.partial)).toEqual(["clipped", null, null, "current"]);
  });

  // 회귀: PR #407 Codex P2 — 오늘이 버킷의 마지막 날이면 exclusive end === 내일이라 `end > 내일` 검사를 빠져나가
  // 9월 30일의 9월 부분 합계가 완결 월로 취급됐다.
  it("partialReason: 오늘이 버킷의 마지막 날이어도 current, 어제 끝난 버킷은 완결", () => {
    const lastDay = { today: "2026-09-30", lowerBound: "2020-06-16" };
    expect(partialReason({ start: "2026-09-01", end: "2026-10-01" }, lastDay)).toBe("current");
    expect(partialReason({ start: "2026-08-01", end: "2026-09-01" }, lastDay)).toBeNull();
    expect(partialReason({ start: "2026-01-01", end: "2027-01-01" }, { ...lastDay, today: "2026-12-31" })).toBe("current");
  });

  it("partialReason: 둘 다 해당하면 current, 주 버킷", () => {
    expect(partialReason({ start: "2026-09-21", end: "2026-09-28" }, ctx)).toBe("current"); // 오늘(월)이 속한 주
    expect(partialReason({ start: "2020-06-15", end: "2020-06-22" }, ctx)).toBe("clipped"); // 하한(화)이 속한 주
    expect(partialReason({ start: "2026-09-01", end: "2026-10-01" }, { today: "2026-09-21", lowerBound: "2026-09-10" })).toBe("current");
  });

  it("주 버킷의 /history 링크는 주의 가운데 날이 속한 달", () => {
    const week: SummaryBucket = { key: "2026-08-31", start: "2026-08-31", end: "2026-09-07", totalDays: 7, values: { runningKm: { value: 30, coveredDays: 3 } } };
    expect(toTrendPoints([week], km, "week", ctx)[0].href).toBe("/history/2026/09");
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
    expect(pivot.cells[2026][8]?.partial).toBe("current");
    expect(pivot.cells[2026][9]).toBeNull();
  });
});

describe("buildYoyRows", () => {
  // 회귀: #395 사전 리뷰 major 3 — 점선이 "직전 완결 달 → 미완결 달" 로만 이어져, 기록 시작일이 걸린 첫 달은
  // 어디에도 연결되지 않은 점 하나로 떠 있었다.
  it("합계형: 미완결 달은 점선 계열에만, 앞뒤 완결 달과 이어진다 (끝 · 처음 양쪽)", () => {
    const pivot = pivotByYear(
      [
        month("2020-06", "runningKm", 40, 5, 15),
        month("2020-07", "runningKm", 110, 12),
        month("2020-08", "runningKm", 120, 13),
        month("2026-08", "runningKm", 140, 14),
        month("2026-09", "runningKm", 60, 8, 21),
      ],
      km,
      ctx,
    );
    const rows = buildYoyRows(pivot, km);
    // 처음: 6월(clipped) 은 점선만, 7월은 실선이면서 점선의 끝점
    expect([rows[5].y2020, rows[5].p2020]).toEqual([null, 40]);
    expect([rows[6].y2020, rows[6].p2020]).toEqual([110, 110]);
    expect([rows[7].y2020, rows[7].p2020]).toEqual([120, null]);
    // 끝: 8월은 실선 + 점선 시작점, 9월(current) 은 점선만
    expect([rows[7].y2026, rows[7].p2026]).toEqual([140, 140]);
    expect([rows[8].y2026, rows[8].p2026]).toEqual([null, 60]);
  });

  it("평균형은 미완결이어도 실선 (부분 합계 문제가 없다) · 저커버리지는 양쪽 다 null", () => {
    const pivot = pivotByYear(
      [month("2026-08", "sleepScore", 78, 28), month("2026-09", "sleepScore", 80, 20, 21), month("2026-07", "sleepScore", 50, 3)],
      sleep,
      ctx,
    );
    const rows = buildYoyRows(pivot, sleep);
    expect([rows[8].y2026, rows[8].p2026]).toEqual([80, null]);
    expect([rows[6].y2026, rows[6].p2026]).toEqual([null, null]);
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

  // 회귀: #395 사전 리뷰 major 2 — 차트는 value 가 number 일 때만 표식을 그린다 (Recharts 는 null 을 0 위치로 그린다).
  // 음수 도메인 지표 (칼로리 밸런스) 에서도 결측 달은 null 로 남아야 한다.
  it("결측 달은 0 이 아니라 null — 음수 지표에서도", () => {
    const balance = getHistoryMetric("calorieBalance");
    const months = seasonality(pivotByYear([month("2026-05", "calorieBalance", -420, 25)], balance, ctx), balance);
    expect(months[4].value).toBe(-420);
    expect(months[3].value).toBeNull();
    expect(months.filter((m) => m.value === 0)).toHaveLength(0);
  });

  it("기여한 해가 없는 달은 null", () => {
    const pivot = pivotByYear([month("2024-05", "vo2max", 49.8, 20)], vo2, ctx);
    expect(seasonality(pivot, vo2)[0]).toEqual({ month: 1, value: null, years: 0, points: [] });
  });
});

// #396: 포인트 → /history 링크가 선택 지표를 싣는다 (회귀: 릴리즈 PR #409 Codex P2 — 체중 추이에서 눌러도 기본 지표로 열림)
describe("bucketHref", () => {
  it("비기본 지표는 ?metric= 을 붙이고 기본 지표 (러닝 거리) 는 붙이지 않는다", () => {
    const bucket = { key: "2024-03", start: "2024-03-01" };
    expect(bucketHref(bucket, "month", weight)).toBe("/history/2024/03?metric=weight");
    expect(bucketHref(bucket, "month", km)).toBe("/history/2024/03");
    expect(bucketHref({ key: "2024", start: "2024-01-01" }, "year", weight)).toBe("/history/2024?metric=weight");
  });

  it("일 버킷은 일 뷰, 주 버킷은 목요일이 속한 달", () => {
    expect(bucketHref({ key: "2024-03-15", start: "2024-03-15" }, "day", sleep)).toBe("/history/2024/03/15?metric=sleepScore");
    expect(bucketHref({ key: "2024-02-26", start: "2024-02-26" }, "week", km)).toBe("/history/2024/02");
    expect(bucketHref({ key: "2024-02-29", start: "2024-02-29" }, "week", km)).toBe("/history/2024/03");
  });

  it("toTrendPoints 의 href 도 같은 규칙", () => {
    const points = toTrendPoints([month("2024-03", "weight", 71.2, 5)], weight, "month", ctx);
    expect(points[0].href).toBe("/history/2024/03?metric=weight");
  });
});
