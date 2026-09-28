// #442 회귀: PR #447 Codex P2 — hrr2 는 값 있는 러닝만 점을 내므로 "N일 달림" 이 러닝 일수를 덜 센다 → 지표별 명사
import { describe, expect, it } from "vitest";
import { coverageText } from "../YearMonthCard";
import { getHistoryMetric } from "@/lib/history/metrics";

describe("coverageText", () => {
  it("러닝 거리는 달린 날 · 2분 HRR 은 회복 기록 일수 · 일별 지표는 기록/전체", () => {
    expect(coverageText({ coveredDays: 12, totalDays: 30 }, getHistoryMetric("runningKm"))).toBe("12일 달림");
    expect(coverageText({ coveredDays: 9, totalDays: 30 }, getHistoryMetric("hrr2"))).toBe("9일 회복 기록");
    expect(coverageText({ coveredDays: 28, totalDays: 30 }, getHistoryMetric("sleepScore"))).toBe("28/30일 기록");
  });
});
