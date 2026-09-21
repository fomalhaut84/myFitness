/**
 * #394 (M15-2): 일간 종합 페이지 데이터. 8개 소스를 병렬 조회해 직렬화 가능한 DTO 로 반환한다 (서버 전용).
 *
 * - **캐시하지 않는다** — 단일 날짜 8쿼리는 가볍고, 방금 기록한 식단·체중이 바로 보여야 한다 (394 스펙 §4.6).
 * - rawData 는 읽지 않는다 (필요한 컬럼만 select).
 * - 일별 모델은 `date = KST 자정` 이지만 수동 체중 입력은 서버 로컬 자정으로 저장된다 (`body-composition/route.ts`
 *   `parseLocalDate` — #365). findUnique 대신 **KST 하루 범위** 로 조회해 방어한다.
 * - 결측은 null. 0 과 구분한다 (걸음 0 ≠ 기록 없음).
 */
import prisma from "@/lib/prisma";
import { isRunningType } from "@/lib/activity/running-types";
import { kstDayRange } from "./buckets";

export const DAY_REPORT_CATEGORIES = ["morning_report", "evening_report"] as const;

export interface HistoryDayActivity {
  id: string;
  name: string;
  activityType: string;
  isRunning: boolean;
  startTime: string;
  durationSec: number;
  distanceM: number | null;
  avgPaceSecPerKm: number | null;
  avgHR: number | null;
  calories: number | null;
}

export interface HistoryDaySleep {
  score: number | null;
  totalMin: number;
  deepMin: number | null;
  lightMin: number | null;
  remMin: number | null;
  awakeMin: number | null;
  sleepStart: string;
  sleepEnd: string;
  hrvOvernight: number | null;
  avgSpO2: number | null;
  lowestSpO2: number | null;
}

export interface HistoryDayVitals {
  restingHR: number | null;
  minHR: number | null;
  maxHR: number | null;
  avgStress: number | null;
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
}

export interface HistoryDayBody {
  weight: number;
  bodyFat: number | null;
  muscleMass: number | null;
  source: string;
}

export interface HistoryDayBloodPressure {
  highSystolic: number;
  lowSystolic: number;
  highDiastolic: number;
  lowDiastolic: number;
  avgPulse: number | null;
  measureCount: number;
}

export interface HistoryDayMovement {
  steps: number | null;
  totalCalories: number | null;
  activeCalories: number | null;
  intakeCalories: number | null;
  calorieBalance: number | null;
}

export interface HistoryDayFood {
  id: string;
  description: string;
  mealType: string | null;
  estimatedKcal: number | null;
  proteinG: number | null;
}

export interface HistoryDayReport {
  id: string;
  category: (typeof DAY_REPORT_CATEGORIES)[number];
  response: string;
}

export interface HistoryDay {
  ymd: string;
  activities: HistoryDayActivity[];
  sleep: HistoryDaySleep | null;
  vitals: HistoryDayVitals | null;
  body: HistoryDayBody | null;
  bloodPressure: HistoryDayBloodPressure | null;
  movement: HistoryDayMovement | null;
  foods: HistoryDayFood[];
  reports: HistoryDayReport[];
}

function allNull(values: readonly (number | null)[]): boolean {
  return values.every((v) => v === null);
}

export async function getHistoryDay(ymd: string): Promise<HistoryDay> {
  const { start, end } = kstDayRange(ymd);
  const inDay = { gte: start, lt: end };

  const [activities, sleep, daily, heart, body, bp, foods, reports] = await Promise.all([
    prisma.activity.findMany({
      where: { startTime: inDay },
      orderBy: { startTime: "asc" },
      select: {
        id: true,
        name: true,
        activityType: true,
        startTime: true,
        duration: true,
        distance: true,
        avgPace: true,
        avgHR: true,
        calories: true,
      },
    }),
    prisma.sleepRecord.findFirst({
      where: { date: inDay },
      select: {
        sleepScore: true,
        totalSleep: true,
        deepSleep: true,
        lightSleep: true,
        remSleep: true,
        awakeDuration: true,
        sleepStart: true,
        sleepEnd: true,
        hrvOvernight: true,
        avgSpO2: true,
        lowestSpO2: true,
      },
    }),
    prisma.dailySummary.findFirst({
      where: { date: inDay },
      select: {
        steps: true,
        totalCalories: true,
        activeCalories: true,
        restingHR: true,
        avgStress: true,
        bodyBatteryHigh: true,
        bodyBatteryLow: true,
        estimatedIntakeCalories: true,
        calorieBalance: true,
      },
    }),
    prisma.heartRateRecord.findFirst({
      where: { date: inDay },
      select: { restingHR: true, minHR: true, maxHR: true },
    }),
    prisma.bodyComposition.findFirst({
      where: { date: inDay },
      select: { weight: true, bodyFat: true, muscleMass: true, source: true },
    }),
    prisma.bloodPressure.findFirst({
      where: { date: inDay },
      select: {
        highSystolic: true,
        lowSystolic: true,
        highDiastolic: true,
        lowDiastolic: true,
        avgPulse: true,
        measureCount: true,
      },
    }),
    prisma.foodLog.findMany({
      where: { date: inDay },
      orderBy: { createdAt: "asc" },
      select: { id: true, description: true, mealType: true, estimatedKcal: true, proteinG: true },
    }),
    prisma.aIAdvice.findMany({
      where: { reportDate: ymd, category: { in: [...DAY_REPORT_CATEGORIES] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, category: true, response: true },
    }),
  ]);

  const vitals: HistoryDayVitals = {
    restingHR: daily?.restingHR ?? heart?.restingHR ?? null,
    minHR: heart?.minHR ?? null,
    maxHR: heart?.maxHR ?? null,
    avgStress: daily?.avgStress ?? null,
    bodyBatteryHigh: daily?.bodyBatteryHigh ?? null,
    bodyBatteryLow: daily?.bodyBatteryLow ?? null,
  };
  const movement: HistoryDayMovement = {
    steps: daily?.steps ?? null,
    totalCalories: daily?.totalCalories ?? null,
    activeCalories: daily?.activeCalories ?? null,
    intakeCalories: daily?.estimatedIntakeCalories ?? null,
    calorieBalance: daily?.calorieBalance ?? null,
  };

  // 같은 category 리포트가 재생성으로 여러 건이면 최신 1건만 (createdAt asc → 뒤가 최신)
  const latestReports = DAY_REPORT_CATEGORIES.flatMap((category) => {
    const matched = reports.filter((r) => r.category === category);
    const latest = matched[matched.length - 1];
    return latest ? [{ id: latest.id, category, response: latest.response }] : [];
  });

  return {
    ymd,
    activities: activities.map((a) => ({
      id: a.id,
      name: a.name,
      activityType: a.activityType,
      isRunning: isRunningType(a.activityType),
      startTime: a.startTime.toISOString(),
      durationSec: a.duration,
      distanceM: a.distance,
      avgPaceSecPerKm: a.avgPace,
      avgHR: a.avgHR,
      calories: a.calories,
    })),
    sleep: sleep
      ? {
          score: sleep.sleepScore,
          totalMin: sleep.totalSleep,
          deepMin: sleep.deepSleep,
          lightMin: sleep.lightSleep,
          remMin: sleep.remSleep,
          awakeMin: sleep.awakeDuration,
          sleepStart: sleep.sleepStart.toISOString(),
          sleepEnd: sleep.sleepEnd.toISOString(),
          hrvOvernight: sleep.hrvOvernight,
          avgSpO2: sleep.avgSpO2,
          lowestSpO2: sleep.lowestSpO2,
        }
      : null,
    vitals: allNull(Object.values(vitals)) ? null : vitals,
    body,
    bloodPressure: bp,
    movement: allNull(Object.values(movement)) ? null : movement,
    foods,
    reports: latestReports,
  };
}
