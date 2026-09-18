// #393 (M15-1) 회귀: 지표별 집계 규칙 (sum / avg / max / last) · 결측 제외 · coveredDays · 입력 불변.
import { describe, expect, it } from "vitest";
import { enumerateBuckets } from "../buckets";
import { getHistoryMetric } from "../metrics";
import { rollup, type DailyPoint } from "../rollup";

const TODAY = "2026-09-18";
const months = enumerateBuckets("2024-01-01", "2024-02-29", "month", TODAY);

describe("rollup — sum (missingAsZero)", () => {
  it("러닝 km 합계 · 값 없는 달은 0 · coveredDays 는 실제 값 있는 날", () => {
    const points: DailyPoint[] = [
      { ymd: "2024-01-03", value: 5.123 },
      { ymd: "2024-01-03", value: 4.5 }, // 하루 2회 러닝 → 같은 날 두 포인트도 합산
      { ymd: "2024-01-31", value: 10 },
    ];
    const out = rollup(points, months, getHistoryMetric("runningKm"));
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ value: 19.62, coveredDays: 2 });
    expect(out[1]).toEqual({ value: 0, coveredDays: 0 });
  });
});

describe("rollup — sum (걸음, 결측은 null)", () => {
  it("값이 하나도 없으면 null", () => {
    const out = rollup([{ ymd: "2024-01-10", value: 8000 }], months, getHistoryMetric("steps"));
    expect(out[0]).toEqual({ value: 8000, coveredDays: 1 });
    expect(out[1]).toEqual({ value: null, coveredDays: 0 });
  });
});

describe("rollup — avg (+min/max, 반올림)", () => {
  it("수면 점수 평균 소수 0자리 · min/max", () => {
    const points: DailyPoint[] = [
      { ymd: "2024-01-01", value: 70 },
      { ymd: "2024-01-02", value: 81 },
      { ymd: "2024-02-01", value: 90 },
    ];
    const out = rollup(points, months, getHistoryMetric("sleepScore"));
    expect(out[0]).toEqual({ value: 76, coveredDays: 2, min: 70, max: 81 });
    expect(out[1]).toEqual({ value: 90, coveredDays: 1, min: 90, max: 90 });
  });

  it("체중 평균 소수 1자리 + last (기간 말 값) · min/max/last 도 같은 자리로 반올림 (사전 리뷰 info 2)", () => {
    const points: DailyPoint[] = [
      { ymd: "2024-01-20", value: 71.25 },
      { ymd: "2024-01-05", value: 72.0 }, // 입력 순서 무관 — last 는 최신 ymd
    ];
    const out = rollup(points, months, getHistoryMetric("weight"));
    expect(out[0]).toEqual({ value: 71.6, coveredDays: 2, min: 71.3, max: 72, last: 71.3 });
    expect(out[1]).toEqual({ value: null, coveredDays: 0, min: null, max: null, last: null });
  });
});

describe("rollup — max / last", () => {
  it("VO2max 는 기간 최고 + last", () => {
    const points: DailyPoint[] = [
      { ymd: "2024-01-01", value: 48.1 },
      { ymd: "2024-01-15", value: 50.4 },
      { ymd: "2024-01-31", value: 49.0 },
    ];
    const out = rollup(points, months, getHistoryMetric("vo2max"));
    expect(out[0]).toEqual({ value: 50.4, coveredDays: 3, last: 49 });
  });

  it("LT 페이스는 기간 말 값", () => {
    const points: DailyPoint[] = [
      { ymd: "2024-01-01", value: 300 },
      { ymd: "2024-01-20", value: 290 },
    ];
    const out = rollup(points, months, getHistoryMetric("ltPace"));
    expect(out[0]).toEqual({ value: 290, coveredDays: 2 });
  });
});

describe("rollup — 주 버킷 (bucketKeyOf 와 키 결합)", () => {
  it("일요일 포인트가 그 주 월요일 키 버킷에 들어간다", () => {
    const weeks = enumerateBuckets("2024-03-11", "2024-03-24", "week", TODAY);
    const points: DailyPoint[] = [
      { ymd: "2024-03-17", value: 10 }, // 일 → 03-11 주
      { ymd: "2024-03-18", value: 5 }, // 월 → 03-18 주
    ];
    const out = rollup(points, weeks, getHistoryMetric("runningKm"));
    expect(weeks.map((w) => w.key)).toEqual(["2024-03-11", "2024-03-18"]);
    expect(out.map((v) => v.value)).toEqual([10, 5]);
  });
});

describe("rollup — 경계 · 불변", () => {
  it("버킷 범위 밖 포인트는 무시", () => {
    const out = rollup([{ ymd: "2023-12-31", value: 5 }, { ymd: "2024-03-01", value: 5 }], months, getHistoryMetric("runningKm"));
    expect(out.map((v) => v.value)).toEqual([0, 0]);
  });

  it("입력 배열을 변경하지 않는다", () => {
    const points: DailyPoint[] = [{ ymd: "2024-01-20", value: 1 }, { ymd: "2024-01-05", value: 2 }];
    const snapshot = JSON.stringify(points);
    rollup(points, months, getHistoryMetric("weight"));
    expect(JSON.stringify(points)).toBe(snapshot);
  });

  it("빈 버킷 목록 → 빈 결과", () => {
    expect(rollup([{ ymd: "2024-01-01", value: 1 }], [], getHistoryMetric("steps"))).toEqual([]);
  });
});
