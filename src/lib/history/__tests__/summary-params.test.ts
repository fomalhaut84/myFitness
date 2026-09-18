// #393 (M15-1) 회귀: /api/history/summary 파라미터 검증 (순수). 클램프 vs 400 경계.
import { describe, expect, it } from "vitest";
import { MAX_DAY_GRANULARITY_SPAN, parseSummaryParams } from "../summary-params";
import { HISTORY_METRIC_IDS } from "../metrics";

const ctx = { todayYmd: "2026-09-18", lowerBound: "2020-06-16" };

describe("parseSummaryParams — 성공 경로", () => {
  it("metrics 생략 = 전체", () => {
    const r = parseSummaryParams({ granularity: "month", from: "2024-01-01", to: "2024-12-31" }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.metrics).toEqual([...HISTORY_METRIC_IDS]);
    expect(r.params.clampedFrom).toBe(false);
    expect(r.params.clampedTo).toBe(false);
  });

  it("metrics 쉼표 목록 · 공백 허용 · 중복 제거", () => {
    const r = parseSummaryParams(
      { granularity: "year", from: "2020-01-01", to: "2026-09-18", metrics: "runningKm, weight,runningKm" },
      ctx,
    );
    expect(r.ok && r.params.metrics).toEqual(["runningKm", "weight"]);
  });

  it("from < lowerBound → 클램프 + 플래그 (400 아님: 연 뷰 첫 해 링크)", () => {
    const r = parseSummaryParams({ granularity: "year", from: "2019-01-01", to: "2020-12-31" }, ctx);
    expect(r.ok && r.params.from).toBe("2020-06-16");
    expect(r.ok && r.params.clampedFrom).toBe(true);
  });

  it("to > today → today 로 클램프", () => {
    const r = parseSummaryParams({ granularity: "month", from: "2026-01-01", to: "2026-12-31" }, ctx);
    expect(r.ok && r.params.to).toBe("2026-09-18");
    expect(r.ok && r.params.clampedTo).toBe(true);
  });

  it("day 는 366일까지 허용", () => {
    const r = parseSummaryParams({ granularity: "day", from: "2024-01-01", to: "2024-12-31" }, ctx);
    expect(r.ok).toBe(true);
    expect(MAX_DAY_GRANULARITY_SPAN).toBe(366);
  });
});

describe("parseSummaryParams — 400 경로", () => {
  it("granularity 누락/오류", () => {
    expect(parseSummaryParams({ from: "2024-01-01", to: "2024-01-31" }, ctx).ok).toBe(false);
    expect(parseSummaryParams({ granularity: "weekly", from: "2024-01-01", to: "2024-01-31" }, ctx).ok).toBe(false);
  });

  it("from/to 형식·실존 오류", () => {
    expect(parseSummaryParams({ granularity: "month", from: "2024-1-1", to: "2024-01-31" }, ctx).ok).toBe(false);
    expect(parseSummaryParams({ granularity: "month", from: "2023-02-29", to: "2024-01-31" }, ctx).ok).toBe(false);
    expect(parseSummaryParams({ granularity: "month", from: "2024-01-01" }, ctx).ok).toBe(false);
  });

  it("from > to (클램프 이후 판정 포함)", () => {
    expect(parseSummaryParams({ granularity: "month", from: "2024-02-01", to: "2024-01-31" }, ctx).ok).toBe(false);
    // from 이 today 보다 뒤: to 는 today 로 클램프되고 from > to
    expect(parseSummaryParams({ granularity: "month", from: "2027-01-01", to: "2027-02-01" }, ctx).ok).toBe(false);
  });

  it("미등록 metric", () => {
    const r = parseSummaryParams({ granularity: "month", from: "2024-01-01", to: "2024-01-31", metrics: "runningKm,nope" }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("nope");
  });

  it("day 367일 초과", () => {
    const r = parseSummaryParams({ granularity: "day", from: "2023-12-31", to: "2024-12-31" }, ctx);
    expect(r.ok).toBe(false);
  });

  it("to 전체가 lowerBound 이전이면 400 (클램프하면 from > to)", () => {
    expect(parseSummaryParams({ granularity: "month", from: "2019-01-01", to: "2019-12-31" }, ctx).ok).toBe(false);
  });
});
