import type { GarminConnect } from "@flow-js/garmin-connect";
import { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { dateRange, isNoDataError, todayKSTString, withRateLimit } from "../utils";
import { extractSleepSpO2 } from "./sleep-spo2";
import { isTrimmedResponse, preserveUpdate } from "../preserve";

export async function syncSleep(
  client: GarminConnect,
  startDate: Date,
  endDate: Date
): Promise<number> {
  let synced = 0;
  const dates = dateRange(startDate, endDate);

  for (const date of dates) {
    try {
      const sleepData = await withRateLimit(() => client.getSleepData(date));

      if (!sleepData?.dailySleepDTO) continue;

      const dto = sleepData.dailySleepDTO;

      if (!dto.sleepStartTimestampGMT || !dto.sleepEndTimestampGMT) continue;

      const calendarDate = dto.calendarDate;
      if (!calendarDate) continue;

      // Garmin calendarDate가 오늘(KST) 이후면 건너뛰기 (미래 날짜 방지)
      if (calendarDate > todayKSTString()) continue;

      // KST midnight UTC instant (서버 타임존 무관, 다른 fetcher와 정합)
      const dayDate = new Date(`${calendarDate}T00:00:00+09:00`);

      // 수면 점수 세부
      const sleepScoreDetails = dto.sleepScores
        ? {
            overall: dto.sleepScores.overall?.value ?? null,
            duration: dto.sleepScores.totalDuration?.qualifierKey ?? null,
            stress: dto.sleepScores.stress?.qualifierKey ?? null,
            awakeCount: dto.sleepScores.awakeCount?.qualifierKey ?? null,
            remPercentage: {
              value: dto.sleepScores.remPercentage?.value ?? null,
              qualifier: dto.sleepScores.remPercentage?.qualifierKey ?? null,
            },
            deepPercentage: {
              value: dto.sleepScores.deepPercentage?.value ?? null,
              qualifier: dto.sleepScores.deepPercentage?.qualifierKey ?? null,
            },
            lightPercentage: {
              value: dto.sleepScores.lightPercentage?.value ?? null,
              qualifier: dto.sleepScores.lightPercentage?.qualifierKey ?? null,
            },
            restlessness: dto.sleepScores.restlessness?.qualifierKey ?? null,
          }
        : null;

      const spo2 = extractSleepSpO2(sleepData);

      const data = {
        sleepStart: new Date(dto.sleepStartTimestampGMT),
        sleepEnd: new Date(dto.sleepEndTimestampGMT),
        totalSleep: Math.round(dto.sleepTimeSeconds / 60),
        deepSleep: dto.deepSleepSeconds
          ? Math.round(dto.deepSleepSeconds / 60)
          : null,
        lightSleep: dto.lightSleepSeconds
          ? Math.round(dto.lightSleepSeconds / 60)
          : null,
        remSleep: dto.remSleepSeconds
          ? Math.round(dto.remSleepSeconds / 60)
          : null,
        awakeDuration: dto.awakeSleepSeconds
          ? Math.round(dto.awakeSleepSeconds / 60)
          : null,
        sleepScore: dto.sleepScores?.overall?.value ?? null,
        // M2: 추가 지표
        avgSpO2: spo2.avg,
        lowestSpO2: spo2.lowest,
        highestSpO2: spo2.highest,
        avgRespiration: toFloat(dto.averageRespirationValue),
        lowestRespiration: toFloat(dto.lowestRespirationValue),
        highestRespiration: toFloat(dto.highestRespirationValue),
        avgSleepStress: toFloat(dto.avgSleepStress),
        bodyBatteryChange: toInt(sleepData.bodyBatteryChange),
        restingHR: toInt(sleepData.restingHeartRate),
        hrvOvernight: toFloat(sleepData.avgOvernightHrv),
        rawData: sleepData as unknown as Prisma.InputJsonValue,
      };
      // #431: sleepScoreDetails 는 update 에서 null 이면 생략 (기존 유지) — DbNull 은 create 에서만 (Prisma 타입이 null 을 받지 않는다)
      const scoreDetails = sleepScoreDetails ? { sleepScoreDetails: sleepScoreDetails as Prisma.InputJsonValue } : {};

      // #431 · #435: 보존 창 (~150일) 밖 재싱크는 야간 HRV · SpO2 epochs · 수면 심박 타임라인이 빠진 채 온다 — 기존 값을 지우지 않는다.
      // 기존 행의 rawData 와 비교해 (하루 1회 조회) 값 있던 키가 사라진 응답이면 rawData 를 유지한다.
      const existing = await prisma.sleepRecord.findUnique({ where: { date: dayDate }, select: { rawData: true } });
      await prisma.sleepRecord.upsert({
        where: { date: dayDate },
        update: { ...preserveUpdate(data, { trimmed: isTrimmedResponse(sleepData, existing?.rawData) }), ...scoreDetails },
        create: { date: dayDate, ...data, sleepScoreDetails: sleepScoreDetails ? (sleepScoreDetails as Prisma.InputJsonValue) : Prisma.DbNull },
      });

      synced++;
    } catch (error) {
      if (isNoDataError(error)) continue;
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
