// #394 (M15-2): 활동 행 → 일별 포인트. prisma 는 모듈 로드만 되고 호출되지 않는다.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import { activityPoints, type ActivityRow } from "../load";
import { averagePaceSecPerKm } from "../kpi";
import { getHistoryMetric } from "../metrics";

const at = (ymd: string) => new Date(`${ymd}T07:00:00+09:00`);
const defs = [getHistoryMetric("runningKm"), getHistoryMetric("runningCount"), getHistoryMetric("runningDurationSec")];

describe("activityPoints", () => {
  // 회귀: PR #402 Codex P2 — 거리 없는 러닝의 시간이 평균 페이스 분자에만 들어가 KPI 가 느려졌다.
  it("거리 없는(0 · null) 러닝은 duration 합계에서 빠진다 — 횟수에는 남는다", () => {
    const rows: ActivityRow[] = [
      { startTime: at("2024-03-01"), activityType: "running", distance: 10_000, duration: 3000 },
      { startTime: at("2024-03-02"), activityType: "running", distance: null, duration: 1800 },
      { startTime: at("2024-03-03"), activityType: "running", distance: 0, duration: 1200 },
    ];
    const points = activityPoints(rows, defs);
    const sum = (id: "runningKm" | "runningDurationSec" | "runningCount") =>
      (points[id] ?? []).reduce((s, p) => s + p.value, 0);

    expect(sum("runningDurationSec")).toBe(3000);
    expect(sum("runningKm")).toBe(10);
    expect(sum("runningCount")).toBe(3);
    expect(averagePaceSecPerKm(sum("runningDurationSec"), sum("runningKm"))).toBe(300);
  });

  it("러닝이 아닌 활동은 제외, 날짜는 KST", () => {
    const rows: ActivityRow[] = [
      { startTime: at("2024-03-01"), activityType: "cycling", distance: 30_000, duration: 3600 },
      { startTime: new Date("2024-03-01T16:00:00Z"), activityType: "running", distance: 5_000, duration: 1500 },
    ];
    const points = activityPoints(rows, defs);
    expect(points.runningKm).toEqual([{ ymd: "2024-03-02", value: 5 }]);
    expect(points.runningCount).toHaveLength(1);
  });
});
