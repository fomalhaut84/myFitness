// #444 F2 · F9: 러닝 창 요약 — 존 합 · 80/20 · 2분 HRR 중앙값. 순수 함수.
import { describe, expect, it } from "vitest";
import { summarizeRunningWindow, toZonePct, toZoneSec, type RunningWindowRow } from "../running-window";

const z = (z1: number, z2: number, z3: number, z4: number, z5: number) => ({ z1, z2, z3, z4, z5 });
const run = (over: Partial<RunningWindowRow> = {}): RunningWindowRow => ({
  activityType: "running",
  zoneDistribution: null,
  hrr2: null,
  ...over,
});

describe("toZoneSec", () => {
  it("정수 초로 반올림 · 합 0 · 형태 불일치는 null", () => {
    expect(toZoneSec(z(142.999, 928.971, 2124.361, 0, 0))).toEqual(z(143, 929, 2124, 0, 0));
    expect(toZoneSec(z(0, 0, 0, 0, 0))).toBeNull();
    expect(toZoneSec({ z1: 1 })).toBeNull();
  });
});

describe("toZonePct", () => {
  it("존 시간 합 기준 정수 % · 합 0 이면 null", () => {
    expect(toZonePct(z(300, 500, 100, 60, 40))).toEqual({ z1: 30, z2: 50, z3: 10, z4: 6, z5: 4 });
    expect(toZonePct(z(0, 0, 0, 0, 0))).toBeNull();
    expect(toZonePct(null)).toBeNull();
  });
});

describe("summarizeRunningWindow", () => {
  it("존 합계 · easy (Z1+Z2) · hard (Z4+Z5) — Z3 은 어느 쪽에도 안 들어간다", () => {
    const s = summarizeRunningWindow([
      run({ zoneDistribution: z(600, 1800, 0, 0, 0) }),
      run({ zoneDistribution: z(0, 600, 600, 300, 100) }),
    ]);
    expect(s.n).toBe(2);
    expect(s.withZones).toBe(2);
    expect(s.zoneTotalsSec).toEqual(z(600, 2400, 600, 300, 100));
    // easy = 3000 / 4000 = 75%, hard = 400 / 4000 = 10%
    expect(s.easyPct).toBe(75);
    expect(s.hardPct).toBe(10);
  });

  it("존 없는 활동은 존 합계에서 빠지고 n 에는 남는다 · 존 합 0 이면 비율 null", () => {
    const s = summarizeRunningWindow([run({ zoneDistribution: z(0, 1200, 0, 0, 0) }), run(), run({ zoneDistribution: z(0, 0, 0, 0, 0) })]);
    expect(s).toMatchObject({ n: 3, withZones: 1, easyPct: 100, hardPct: 0 });
    const none = summarizeRunningWindow([run(), run({ zoneDistribution: z(0, 0, 0, 0, 0) })]);
    expect(none).toMatchObject({ n: 2, withZones: 0, zoneTotalsSec: null, easyPct: null, hardPct: null });
  });

  it("Garmin 소수 초는 합계에서 정수 초로 반올림한다", () => {
    const s = summarizeRunningWindow([run({ zoneDistribution: z(0.423, 100.5, 0.1, 0, 0) }), run({ zoneDistribution: z(220, 0.472, 0.2, 0, 0) })]);
    expect(s.zoneTotalsSec).toEqual(z(220, 101, 0, 0, 0));
  });

  it("Prisma Json 형태(unknown)의 존 분포도 읽는다 · 형태가 아니면 제외", () => {
    const s = summarizeRunningWindow([
      run({ zoneDistribution: { z1: "100", z2: 300, z3: 0, z4: 0, z5: 0 } }),
      run({ zoneDistribution: { z1: 1 } }),
      run({ zoneDistribution: "bad" }),
    ]);
    expect(s.withZones).toBe(1);
    expect(s.zoneTotalsSec).toEqual(z(100, 300, 0, 0, 0));
  });

  it("hrr2 중앙값 — 홀수 · 짝수 · 없으면 null", () => {
    expect(summarizeRunningWindow([run({ hrr2: 30 }), run({ hrr2: 20 }), run({ hrr2: 41 })]).hrr2).toEqual({ median: 30, n: 3 });
    expect(summarizeRunningWindow([run({ hrr2: 30 }), run({ hrr2: 21 }), run(), run({ hrr2: 40 }), run({ hrr2: 10 })]).hrr2).toEqual({ median: 26, n: 4 });
    expect(summarizeRunningWindow([run(), run()]).hrr2).toBeNull();
  });

  it("러닝 계열만 센다 (트레일 포함 · 사이클 제외) · 빈 창", () => {
    const s = summarizeRunningWindow([
      run({ activityType: "trail_running", zoneDistribution: z(0, 600, 0, 0, 0), hrr2: 25 }),
      run({ activityType: "cycling", zoneDistribution: z(0, 0, 0, 6000, 0), hrr2: 99 }),
    ]);
    expect(s).toMatchObject({ n: 1, withZones: 1, easyPct: 100, hardPct: 0, hrr2: { median: 25, n: 1 } });
    expect(summarizeRunningWindow([])).toEqual({ n: 0, withZones: 0, zoneTotalsSec: null, easyPct: null, hardPct: null, hrr2: null });
  });
});
