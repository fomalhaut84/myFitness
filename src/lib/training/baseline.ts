// M6-1/M6-4: 최근 28일 러닝 데이터에서 baseline (주간 km + ACWR + 거리 가중 pace) 산출.
// training-plan 생성기와 recommend-today-workout fallback 이 같은 baseline 을 사용.

import prisma from "@/lib/prisma";
import { todayKST, daysAgoKST, ymdKST } from "../garmin/utils";

const DAY_MS = 24 * 60 * 60 * 1000;
const BASELINE_WINDOW_DAYS = 28;
const ACWR_ACUTE_DAYS = 7;
const SLIDING_WINDOW_DAYS = 7;
export const MIN_BASELINE_WEEKLY_KM = 15;
export const LOW_VOLUME_THRESHOLD_KM_PER_WEEK = 5;

export interface Baseline {
  weeklyKm: number;
  acwr: number | null;
  recentAvgPace: number | null; // sec/km, 거리 가중 평균
  // M8: 최근 28일 데이터의 7일 슬라이딩 윈도우 최대 주간 km. target 스케일링 sanity cap 에 사용.
  historicalMaxWeekKm: number;
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
    return {
      weeklyKm: MIN_BASELINE_WEEKLY_KM,
      acwr: null,
      recentAvgPace: null,
      historicalMaxWeekKm: 0,
    };
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

  // 7일 슬라이딩 윈도우 최대 주간 km.
  // KST 일별 그룹핑 → 최근 28일 배열 [day-27, ..., day-0=today] → 22개 창 (i=0..21) 최대값.
  const dailyKm = new Map<string, number>();
  for (const r of rows) {
    const key = ymdKST(r.startTime);
    const km = (r.distance ?? 0) / 1000;
    dailyKm.set(key, (dailyKm.get(key) ?? 0) + km);
  }
  const daysArr: number[] = [];
  for (let i = BASELINE_WINDOW_DAYS - 1; i >= 0; i--) {
    daysArr.push(dailyKm.get(ymdKST(daysAgoKST(i))) ?? 0);
  }
  let historicalMaxWeekKm = 0;
  for (let i = 0; i + SLIDING_WINDOW_DAYS <= daysArr.length; i++) {
    let sum = 0;
    for (let j = 0; j < SLIDING_WINDOW_DAYS; j++) sum += daysArr[i + j];
    if (sum > historicalMaxWeekKm) historicalMaxWeekKm = sum;
  }

  return {
    weeklyKm: Math.round(weeklyKm * 10) / 10,
    acwr,
    recentAvgPace: recentAvgPace !== null ? Math.round(recentAvgPace) : null,
    historicalMaxWeekKm: Math.round(historicalMaxWeekKm * 10) / 10,
  };
}
