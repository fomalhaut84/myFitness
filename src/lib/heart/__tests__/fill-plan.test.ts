// #425: hrr2 · hrrDrop10 채움의 순수 부분 — 청크 → 필요한 일자 · 시계열 합치기 · 곡선 → update payload.
import { describe, expect, it } from "vitest";
import { mergeSeries, planChunk, recoveryPayload } from "../fill-plan";
import type { HrSample, RecoveryCurve } from "../recovery";

const utc = (iso: string) => new Date(iso);

describe("planChunk", () => {
  it("활동별 종료 시각 · 일자 키, 청크 전체의 고유 일자 (정렬)", () => {
    const plan = planChunk([
      // 2026-04-05 21:51 KST 시작 · elapsed 3205s → 22:44:39 KST 종료 → 04-05 하루
      { id: "a", startTime: utc("2026-04-05T12:51:14Z"), duration: 3000, rawData: { elapsedDuration: 3205 } },
      // 23:55 KST 종료 → 04-05 · 04-06 (뒤 창)
      { id: "b", startTime: utc("2026-04-05T14:00:00Z"), duration: 3300, rawData: null },
      // 00:02 KST 06 종료 → 04-05 · 04-06 (앞 창)
      { id: "c", startTime: utc("2026-04-05T14:30:00Z"), duration: 1920, rawData: {} },
    ]);
    expect(plan.items.map((i) => [i.id, i.dayKeys])).toEqual([
      ["a", ["2026-04-05"]],
      ["b", ["2026-04-05", "2026-04-06"]],
      ["c", ["2026-04-05", "2026-04-06"]],
    ]);
    expect(plan.items[0].endMs).toBe(utc("2026-04-05T12:51:14Z").getTime() + 3205 * 1000);
    expect(plan.dayKeys).toEqual(["2026-04-05", "2026-04-06"]);
  });

  it("빈 청크", () => {
    expect(planChunk([])).toEqual({ items: [], dayKeys: [] });
  });
});

describe("mergeSeries", () => {
  it("일자 순으로 합치고 없는 날은 건너뛴다", () => {
    const byDay = new Map<string, HrSample[]>([
      ["2026-04-06", [[6, 70]]],
      ["2026-04-05", [[5, 120], [5.5, null]]],
    ]);
    expect(mergeSeries(byDay, ["2026-04-05", "2026-04-06", "2026-04-07"])).toEqual([[5, 120], [5.5, null], [6, 70]]);
    expect(mergeSeries(byDay, ["2026-04-07"])).toEqual([]);
  });
});

describe("recoveryPayload", () => {
  const curve = (hrr2: number | null, drop10: number | null): RecoveryCurve => ({ endMs: 0, points: [], hrr2, drop10, postSamples: 0 });

  it("hrr2 가 있으면 payload · hrrDrop10 은 독립 (10분 결측이면 null)", () => {
    expect(recoveryPayload(curve(16, 48))).toEqual({ hrr2: 16, hrrDrop10: 48 });
    expect(recoveryPayload(curve(16, null))).toEqual({ hrr2: 16, hrrDrop10: null });
    expect(recoveryPayload(curve(-4, 10))).toEqual({ hrr2: -4, hrrDrop10: 10 });
  });

  it("hrr2 결측 (부분 데이터 · 워치 벗음) 이면 null — 0 을 쓰지 않는다", () => {
    expect(recoveryPayload(curve(null, 48))).toBeNull();
    expect(recoveryPayload(curve(null, null))).toBeNull();
  });
});
