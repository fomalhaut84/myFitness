import type { InsightRun } from "../types";

export function run(ymd: string, over: Partial<InsightRun> = {}): InsightRun {
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
  };
}

export const ctx = { today: "2026-09-21", lowerBound: "2020-06-16" };
