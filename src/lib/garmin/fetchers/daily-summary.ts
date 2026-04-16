import type { GarminConnect } from "@flow-js/garmin-connect";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { recalculateCalorieBalance } from "@/lib/fitness/calorie-balance";
import { dateRange, formatDate, startOfDay, todayKSTString, withRateLimit } from "../utils";

const DAILY_SUMMARY_URL =
  "https://connectapi.garmin.com/usersummary-service/usersummary/daily";

export async function syncDailySummaries(
  client: GarminConnect,
  startDate: Date,
  endDate: Date
): Promise<number> {
  let synced = 0;
  const dates = dateRange(startDate, endDate);

  for (const date of dates) {
    try {
      const dateStr = formatDate(date);
      const summary = await withRateLimit(() =>
        client.get<Record<string, unknown>>(
          `${DAILY_SUMMARY_URL}?calendarDate=${dateStr}`
        )
      );

      if (!summary || !summary.calendarDate) continue;

      // Garmin calendarDate가 오늘(KST) 이후면 건너뛰기 (미래 날짜 방지)
      if (String(summary.calendarDate) > todayKSTString()) continue;

      const dayDate = startOfDay(date);
      const moderate = toInt(summary.moderateIntensityMinutes);
      const vigorous = toInt(summary.vigorousIntensityMinutes);
      const intensityMin =
        moderate !== null || vigorous !== null
          ? (moderate ?? 0) + (vigorous ?? 0)
          : null;

      const data = {
        steps: toInt(summary.totalSteps),
        totalCalories: toInt(summary.totalKilocalories),
        activeCalories: toInt(summary.activeKilocalories),
        restingHR: toInt(summary.restingHeartRate),
        avgStress: toInt(summary.averageStressLevel),
        bodyBattery: toInt(summary.bodyBatteryMostRecentValue),
        bodyBatteryHigh: toInt(summary.bodyBatteryHighestValue),
        bodyBatteryLow: toInt(summary.bodyBatteryLowestValue),
        intensityMin,
        floorsClimbed: toInt(summary.floorsAscended),
        // M2: 추가 지표
        avgSpo2: toFloat(summary.averageSpo2),
        lowestSpo2: toFloat(summary.lowestSpo2),
        avgRespiration: toFloat(summary.avgWakingRespirationValue),
        stressHighDuration: toMinutes(summary.highStressDuration),
        stressMediumDuration: toMinutes(summary.mediumStressDuration),
        stressLowDuration: toMinutes(summary.lowStressDuration),
        bodyBatteryCharged: toInt(summary.bodyBatteryChargedValue),
        bodyBatteryDrained: toInt(summary.bodyBatteryDrainedValue),
        rawData: summary as Prisma.InputJsonValue,
      };

      await prisma.dailySummary.upsert({
        where: { date: dayDate },
        update: data,
        create: { date: dayDate, ...data },
      });

      // M4-2: 칼로리 밸런스 재계산 (targetCalories + activeCalories, 섭취와 비교)
      await recalculateCalorieBalance(dayDate);

      synced++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("404") || msg.includes("not found")) continue;
      throw error;
    }
  }

  return synced;
}

function toInt(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : Math.round(n);
}

function toFloat(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

/** Garmin은 스트레스 시간을 초 단위로 반환 → 분으로 변환 */
function toMinutes(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : Math.round(n / 60);
}
