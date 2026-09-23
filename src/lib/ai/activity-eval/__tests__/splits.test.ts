// #440: km 스플릿 파생값 — 모델이 42행 표에서 직접 계산하지 않도록 서버가 미리 센다.
import { describe, expect, it } from "vitest";
import { KM_LAP_MAX_M, KM_LAP_MIN_M, LAP_TABLE_MAX_ROWS, kmLaps, lapTableLines, summarizeLaps, toEvalLaps } from "../splits";

/** 페이스 (초/km) 목록 → 1km 랩. `averageSpeed` 는 m/s */
function lap(paceSec: number, extra: Partial<{ distance: number; averageHR: number; averageRunCadence: number; elevationGain: number }> = {}) {
  const distance = extra.distance ?? 1000;
  return {
    distance,
    duration: (paceSec * distance) / 1000,
    averageSpeed: 1000 / paceSec,
    averageHR: extra.averageHR ?? 140,
    maxHR: 150,
    averageRunCadence: extra.averageRunCadence ?? 170,
    elevationGain: extra.elevationGain ?? 0,
  };
}

describe("toEvalLaps", () => {
  it("Garmin lapDTO 를 검증해 페이스 (초/km) 를 계산하고 형태가 아닌 원소는 버린다", () => {
    const laps = toEvalLaps([lap(300), { distance: "x" }, null, { distance: 1000, duration: 320, averageSpeed: 0 }]);
    expect(laps).toHaveLength(2);
    expect(laps[0].paceSecPerKm).toBe(300);
    expect(laps[0].avgHR).toBe(140);
    // averageSpeed 0 → 페이스 null (0 으로 나누지 않는다)
    expect(laps[1].paceSecPerKm).toBeNull();
  });

  it("배열이 아니면 빈 배열", () => {
    expect(toEvalLaps(undefined)).toEqual([]);
    expect(toEvalLaps({})).toEqual([]);
  });
});

describe("kmLaps", () => {
  it("900~1,100m 랩만 남긴다 (SplitChart 규칙)", () => {
    const laps = toEvalLaps([lap(300), lap(300, { distance: 420 }), lap(300, { distance: 1100 }), lap(300, { distance: 899 })]);
    expect(kmLaps(laps).map((l) => l.distanceM)).toEqual([1000, 1100]);
    expect(KM_LAP_MIN_M).toBe(900);
    expect(KM_LAP_MAX_M).toBe(1100);
  });
});

describe("summarizeLaps", () => {
  it("가장 빠른/느린 km · 첫 km 오버페이스 · 전후반 split · 변동계수 · 심박 드리프트", () => {
    // 첫 km 가 가장 빠르고 (오버페이스) 후반이 느려지는 positive split
    const laps = toEvalLaps([lap(290, { averageHR: 130 }), lap(300, { averageHR: 135 }), lap(310, { averageHR: 145 }), lap(320, { averageHR: 150 })]);
    const s = summarizeLaps(laps);
    expect(s).not.toBeNull();
    expect(s!.count).toBe(4);
    expect(s!.fastest).toEqual({ index: 1, paceSecPerKm: 290 });
    expect(s!.slowest).toEqual({ index: 4, paceSecPerKm: 320 });
    // 평균 305 → 첫 km 는 15초 빠르다 (음수 = 오버페이스)
    expect(s!.firstKmDeltaSec).toBe(-15);
    // 전반 295 · 후반 315 → +20 (positive split)
    expect(s!.halfSplitSec).toBe(20);
    // 전반 HR 132.5 · 후반 147.5 → +15
    expect(s!.hrDriftBpm).toBe(15);
    expect(s!.paceCv).toBeCloseTo(0.0366, 3);
  });

  it("km 랩이 1개면 split · 드리프트는 null, 가장 빠른 km 는 있다", () => {
    const s = summarizeLaps(toEvalLaps([lap(300)]));
    expect(s!.count).toBe(1);
    expect(s!.fastest.paceSecPerKm).toBe(300);
    expect(s!.halfSplitSec).toBeNull();
    expect(s!.hrDriftBpm).toBeNull();
    expect(s!.firstKmDeltaSec).toBeNull();
  });

  it("홀수 개면 가운데 랩은 전후반 어디에도 넣지 않는다", () => {
    const s = summarizeLaps(toEvalLaps([lap(300), lap(400), lap(320)]));
    expect(s!.halfSplitSec).toBe(20);
  });

  it("심박 없는 랩은 드리프트 계산에서 빠지고, 전부 없으면 null", () => {
    const noHr = toEvalLaps([lap(300), lap(310)]).map((l) => ({ ...l, avgHR: null }));
    expect(summarizeLaps(noHr)!.hrDriftBpm).toBeNull();
  });

  it("km 랩 0개 · 페이스 없는 랩만 → null", () => {
    expect(summarizeLaps([])).toBeNull();
    expect(summarizeLaps(toEvalLaps([lap(300, { distance: 500 })]))).toBeNull();
    expect(summarizeLaps(toEvalLaps([{ distance: 1000, duration: 300, averageSpeed: 0 }]))).toBeNull();
  });
});

describe("lapTableLines", () => {
  it("km 별 한 줄 — 페이스 · 심박 · 케이던스 · 고도. 결측 칸은 —", () => {
    const lines = lapTableLines(toEvalLaps([lap(300, { averageHR: 140, averageRunCadence: 172, elevationGain: 3 })]).map((l, i) => (i === 0 ? { ...l, avgCadence: null } : l)));
    expect(lines).toEqual(["1km 5'00\" · 140bpm · — spm · +3m"]);
  });

  it("상한을 넘으면 5km 묶음 평균으로", () => {
    const many = toEvalLaps(Array.from({ length: LAP_TABLE_MAX_ROWS + 1 }, (_, i) => lap(300 + i)));
    const lines = lapTableLines(many);
    expect(lines.length).toBe(Math.ceil((LAP_TABLE_MAX_ROWS + 1) / 5));
    expect(lines[0]).toMatch(/^1~5km /);
    expect(lines[lines.length - 1]).toMatch(/^61km /);
  });
});
