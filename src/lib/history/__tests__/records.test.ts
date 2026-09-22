// #396 (M15-4): 개인 기록 랭킹 (순수).
import { describe, expect, it } from "vitest";
import { bestRunningMonth, firstExtreme, rankRunningRecords, toRaceRow, type RunningRecordRow } from "../records";
import type { SummaryBucket } from "../summary";

function run(ymd: string, km: number, pace: number, extra: Partial<RunningRecordRow> = {}): RunningRecordRow {
  return { id: ymd, ymd, name: "러닝", distanceM: km * 1000, durationSec: Math.round(km * pace), avgPace: pace, race: false, ...extra };
}

describe("firstExtreme", () => {
  it("동률이면 먼저 달성한 날", () => {
    const rows = [run("2024-05-01", 10, 280), run("2023-11-19", 10, 280), run("2025-01-15", 10, 292)];
    expect(firstExtreme(rows, (r) => r.avgPace, (r) => r.ymd, "min")?.ymd).toBe("2023-11-19");
    expect(firstExtreme(rows, (r) => r.avgPace, (r) => r.ymd, "max")?.ymd).toBe("2025-01-15");
    expect(firstExtreme([], (r: RunningRecordRow) => r.avgPace, (r) => r.ymd, "min")).toBeNull();
  });
});

describe("rankRunningRecords", () => {
  it("거리 버킷별 최저 페이스 · 버킷 밖 거리 (15km) 는 버킷 기록에 안 들어간다", () => {
    const rows = [
      run("2024-03-09", 5.01, 272),
      run("2021-11-28", 10.04, 281, { race: true }),
      run("2022-05-27", 10.21, 287),
      run("2023-10-22", 21.1, 289, { race: true }),
      run("2024-03-17", 30.12, 341),
      run("2024-06-01", 15, 260),
    ];
    const byBucket = rankRunningRecords(rows);
    expect(byBucket["5k"]?.ymd).toBe("2024-03-09");
    expect(byBucket["10k"]?.ymd).toBe("2021-11-28");
    expect(byBucket["10k"]?.race).toBe(true);
    expect(byBucket.HM?.ymd).toBe("2023-10-22");
    expect(byBucket.FM).toBeNull();
  });

  it("빈 입력", () => {
    expect(Object.values(rankRunningRecords([])).every((v) => v === null)).toBe(true);
  });
});

// 회귀: 사전 리뷰 major 2 — 거리 0 · 페이스 없는 레이스 (실내 · 비러닝) 가 목록에서 조용히 빠지고 건수가 틀렸다
describe("toRaceRow", () => {
  it("거리 · 페이스가 없어도 행을 만든다 (null 로)", () => {
    const row = toRaceRow({ id: "a", startTime: new Date("2025-01-15T00:30:00Z"), name: "실내 레이스", distance: 0, duration: 3600, avgPace: null, eventType: "race" });
    expect(row).toEqual({ id: "a", ymd: "2025-01-15", name: "실내 레이스", distanceM: null, durationSec: 3600, avgPace: null });
  });
});

describe("bestRunningMonth", () => {
  function month(ym: string, km: number | null, count: number | null = null): SummaryBucket {
    const [y, m] = ym.split("-").map(Number);
    const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    return {
      key: ym,
      start: `${ym}-01`,
      end,
      totalDays: 30,
      values: { runningKm: { value: km, coveredDays: km ? 20 : 0 }, runningCount: { value: count, coveredDays: count ? 20 : 0 } },
    };
  }

  it("최대 km 월 · 횟수 병기 · 동률은 먼저 온 달", () => {
    const best = bestRunningMonth([month("2024-03", 312.4, 24), month("2024-04", 312.4, 20), month("2024-05", 200, 18)], "2026-09-21");
    expect(best).toEqual({ ym: "2024-03", km: 312.4, count: 24, current: false });
  });

  it("이번 달이 최다면 제외하지 않고 current 로 표시 · 기록 없으면 null", () => {
    const best = bestRunningMonth([month("2026-08", 100, 10), month("2026-09", 150, 12)], "2026-09-21");
    expect(best).toMatchObject({ ym: "2026-09", current: true });
    expect(bestRunningMonth([month("2026-08", 0), month("2026-09", null)], "2026-09-21")).toBeNull();
  });
});
