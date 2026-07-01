// M6-1/M6-4: 최근 28일 러닝 데이터에서 baseline (주간 km + ACWR + 거리 가중 pace) 산출.
// training-plan 생성기와 recommend-today-workout fallback 이 같은 baseline 을 사용.

import prisma from "../../mcp/prisma";
import { todayKST, daysAgoKST } from "../garmin/utils";

const DAY_MS = 24 * 60 * 60 * 1000;
const BASELINE_WINDOW_DAYS = 28;
const ACWR_ACUTE_DAYS = 7;
export const MIN_BASELINE_WEEKLY_KM = 15;
export const LOW_VOLUME_THRESHOLD_KM_PER_WEEK = 5;

export interface Baseline {
  weeklyKm: number;
  acwr: number | null;
  recentAvgPace: number | null; // sec/km, 거리 가중 평균
}

export async function computeBaseline(): Promise<Baseline> {
  const since = daysAgoKST(BASELINE_WINDOW_DAYS - 1);
  const tomorrow = new Date(todayKST().getTime() + DAY_MS);
  const rows = await prisma.activity.findMany({
    where: {
      startTime: { gte: since, lt: tomorrow },
      activityType: { contains: "running" },
      distance: { not: null },
    },
    select: { startTime: true, distance: true, avgPace: true },
  });

  if (rows.length === 0) {
    return { weeklyKm: MIN_BASELINE_WEEKLY_KM, acwr: null, recentAvgPace: null };
  }

  const totalKm = rows.reduce((sum, r) => sum + (r.distance ?? 0) / 1000, 0);
  const rawWeeklyKm = totalKm / 4;
  const weeklyKm =
    rawWeeklyKm < LOW_VOLUME_THRESHOLD_KM_PER_WEEK
      ? MIN_BASELINE_WEEKLY_KM
      : rawWeeklyKm;

  const acuteSince = daysAgoKST(ACWR_ACUTE_DAYS - 1);
  const acuteKm = rows
    .filter((r) => r.startTime >= acuteSince)
    .reduce((sum, r) => sum + (r.distance ?? 0) / 1000, 0);
  const acuteDaily = acuteKm / ACWR_ACUTE_DAYS;
  const chronicDaily = totalKm / BASELINE_WINDOW_DAYS;
  const acwr =
    chronicDaily > 0 ? Math.round((acuteDaily / chronicDaily) * 100) / 100 : null;

  // 거리 가중 평균 pace: 총 시간(초) / 총 거리(km).
  const pacedRows = rows.filter(
    (r) => r.avgPace !== null && r.distance !== null && r.distance > 0
  );
  let pacedTotalSec = 0;
  let pacedTotalKm = 0;
  for (const r of pacedRows) {
    const distKm = (r.distance ?? 0) / 1000;
    pacedTotalSec += (r.avgPace ?? 0) * distKm;
    pacedTotalKm += distKm;
  }
  const recentAvgPace = pacedTotalKm > 0 ? pacedTotalSec / pacedTotalKm : null;

  return {
    weeklyKm: Math.round(weeklyKm * 10) / 10,
    acwr,
    recentAvgPace: recentAvgPace !== null ? Math.round(recentAvgPace) : null,
  };
}
