// #397 C: 월별 존 비율.
import { describe, expect, it } from "vitest";
import { zoneShareByMonth, zoneShareCompare } from "../zones";
import { ctx, run } from "./fixtures";

const z = (z1: number, z2: number, z3: number, z4: number, z5: number) => ({ z1, z2, z3, z4, z5 });

describe("zoneShareByMonth", () => {
  it("존 있는 첫 달 ~ 이번 달, 빈 달 포함 · 비율 합 = 1 · 저커버리지 · current", () => {
    const runs = [
      run("2026-06-10", { zones: z(60, 540, 0, 0, 0) }),
      run("2026-06-20", { zones: z(0, 300, 300, 0, 0) }),
      run("2026-06-25"), // 존 없음 → 6월 2/3 — 저커버리지 아님
      run("2026-08-01", { zones: z(0, 0, 0, 600, 0) }),
      run("2026-08-02"),
      run("2026-08-03"), // 8월 1/3 → 저커버리지
      run("2026-09-05", { zones: z(0, 600, 0, 0, 0) }),
      run("2026-03-01"), // 존 시작 전 달은 축에 없다
    ];
    const months = zoneShareByMonth(runs, ctx);
    expect(months.map((m) => m.key)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
    const jun = months[0];
    expect(jun).toMatchObject({ runs: 3, withZones: 2, lowCoverage: false, current: false });
    expect(jun.share?.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 10);
    expect(jun.share?.[1]).toBeCloseTo(840 / 1200, 10);
    expect(months[1]).toMatchObject({ runs: 0, withZones: 0, lowCoverage: false, share: null });
    expect(months[2]).toMatchObject({ runs: 3, withZones: 1, lowCoverage: true });
    expect(months[3]).toMatchObject({ current: true });
  });

  // 회귀: PR #417 Codex P2 — 트레드밀 (거리 없음) 도 존이 있으면 달의 비율 · 커버리지에 들어간다
  it("거리 · 페이스 없는 러닝도 존이 있으면 센다", () => {
    const months = zoneShareByMonth([run("2026-08-01", { distanceM: null, avgPace: null, zones: z(0, 600, 0, 0, 0) }), run("2026-08-02")], ctx);
    expect(months[0]).toMatchObject({ key: "2026-08", runs: 2, withZones: 1, lowCoverage: false });
    expect(months[0].share?.[1]).toBe(1);
  });

  it("존 있는 러닝이 없으면 빈 배열", () => {
    expect(zoneShareByMonth([run("2026-06-10")], ctx)).toEqual([]);
  });
});

describe("zoneShareCompare", () => {
  it("최근 12개월 (이번 달 포함) vs 그 전 12개월 · 저커버리지 달 제외", () => {
    const runs = [
      run("2024-10-05", { zones: z(0, 500, 500, 0, 0) }), // 그 전 12개월 (2024-10 ~ 2025-09)
      run("2025-09-05", { zones: z(0, 1000, 0, 0, 0) }),
      run("2025-10-05", { zones: z(0, 0, 0, 500, 500) }), // 최근 12개월 (2025-10 ~ 2026-09)
      run("2026-09-05", { zones: z(0, 1000, 0, 0, 0) }),
      run("2026-05-01", { zones: z(1000, 0, 0, 0, 0) }),
      run("2026-05-02"),
      run("2026-05-03"), // 저커버리지 → 제외
    ];
    const cmp = zoneShareCompare(zoneShareByMonth(runs, ctx), ctx);
    expect(cmp.previous).toEqual({ months: 2, easy: 0.75, hard: 0 });
    expect(cmp.recent).toEqual({ months: 2, easy: 0.5, hard: 0.5 });
  });
});
