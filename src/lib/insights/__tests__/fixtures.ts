import type { InsightRun, UsableRun } from "../types";

/** 기본은 거리 · 페이스가 있는 러닝 (`UsableRun`). 존 · 필터 테스트는 `distanceM: null` 등으로 덮어쓴다 (타입은 테스트 편의상 넓게 캐스트). */
export function run(ymd: string, over: Partial<InsightRun> = {}): UsableRun {
  return {
    id: over.id ?? ymd,
    ymd,
    year: Number(ymd.slice(0, 4)),
    distanceM: 10_000,
    durationSec: 3_100,
    avgPace: 310,
    avgHR: 150,
    tempC: 18,
    humidityPct: 60,
    zones: null,
    race: false,
    ...over,
  } as UsableRun;
}

export const ctx = { today: "2026-09-21", lowerBound: "2020-06-16" };
