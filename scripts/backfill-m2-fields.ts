import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { extractSleepSpO2 } from "../src/lib/garmin/fetchers/sleep-spo2";

const prisma = new PrismaClient();

async function backfillActivities() {
  console.log("=== Activity M2 필드 backfill ===");
  const activities = await prisma.activity.findMany({
    where: { avgCadence: null },
    select: { id: true, rawData: true },
  });

  console.log(`대상: ${activities.length}건`);
  let updated = 0;

  for (const a of activities) {
    const raw = a.rawData as Record<string, unknown> | null;
    if (!raw) continue;

    const summaryDTO = raw.summaryDTO as Record<string, unknown> | undefined;

    await prisma.activity.update({
      where: { id: a.id },
      data: {
        avgCadence: toInt(raw.averageRunningCadenceInStepsPerMinute ?? summaryDTO?.averageRunCadence),
        avgStrideLength: toFloat(raw.avgStrideLength),
        avgVerticalOscillation: toFloat(raw.avgVerticalOscillation),
        avgGroundContactTime: toFloat(raw.avgGroundContactTime),
        aerobicTE: toFloat(raw.aerobicTrainingEffect ?? summaryDTO?.trainingEffect),
        anaerobicTE: toFloat(raw.anaerobicTrainingEffect ?? summaryDTO?.anaerobicTrainingEffect),
        avgRespirationRate: toFloat(raw.avgRespirationRate),
        lapCount: toInt(raw.lapCount),
        splitSummaries: raw.splitSummaries ? raw.splitSummaries as object : undefined,
      },
    });
    updated++;
  }

  console.log(`업데이트: ${updated}건`);
}

async function backfillSleep() {
  console.log("\n=== SleepRecord M2 필드 backfill ===");
  // #338: SpO2 는 파싱 키 오타로 전 기간 null 이었다. 호흡수는 이미 백필된 행이 많아
  // avgRespiration 조건만으로는 그 행들을 다시 훑지 못하므로 SpO2 결측도 조건에 포함한다.
  // 실제로 SpO2 를 측정하지 않은 야간은 매 실행마다 재선택되지만 update 는 멱등이라 무해.
  const records = await prisma.sleepRecord.findMany({
    where: {
      OR: [
        { avgRespiration: null },
        { avgSpO2: null },
        { lowestSpO2: null },
        { highestSpO2: null },
      ],
    },
    select: { id: true, rawData: true },
  });

  console.log(`대상: ${records.length}건`);
  let updated = 0;

  for (const r of records) {
    const raw = r.rawData as Record<string, unknown> | null;
    if (!raw) continue;

    const dto = raw.dailySleepDTO as Record<string, unknown> | undefined;
    if (!dto) continue;

    const sleepScores = dto.sleepScores as Record<string, unknown> | undefined;
    const sleepScoreDetails = sleepScores
      ? {
          overall: (sleepScores.overall as Record<string, unknown>)?.value ?? null,
          duration: (sleepScores.totalDuration as Record<string, unknown>)?.qualifierKey ?? null,
          stress: (sleepScores.stress as Record<string, unknown>)?.qualifierKey ?? null,
          awakeCount: (sleepScores.awakeCount as Record<string, unknown>)?.qualifierKey ?? null,
          remPercentage: {
            value: (sleepScores.remPercentage as Record<string, unknown>)?.value ?? null,
            qualifier: (sleepScores.remPercentage as Record<string, unknown>)?.qualifierKey ?? null,
          },
          deepPercentage: {
            value: (sleepScores.deepPercentage as Record<string, unknown>)?.value ?? null,
            qualifier: (sleepScores.deepPercentage as Record<string, unknown>)?.qualifierKey ?? null,
          },
          lightPercentage: {
            value: (sleepScores.lightPercentage as Record<string, unknown>)?.value ?? null,
            qualifier: (sleepScores.lightPercentage as Record<string, unknown>)?.qualifierKey ?? null,
          },
          restlessness: (sleepScores.restlessness as Record<string, unknown>)?.qualifierKey ?? null,
        }
      : undefined;

    // fetcher 와 동일한 파싱 경로를 재사용 — 키 오타가 한쪽에만 남는 것을 방지.
    const spo2 = extractSleepSpO2(raw);

    await prisma.sleepRecord.update({
      where: { id: r.id },
      data: {
        avgSpO2: spo2.avg,
        lowestSpO2: spo2.lowest,
        highestSpO2: spo2.highest,
        avgRespiration: toFloat(dto.averageRespirationValue),
        lowestRespiration: toFloat(dto.lowestRespirationValue),
        highestRespiration: toFloat(dto.highestRespirationValue),
        avgSleepStress: toFloat(dto.avgSleepStress),
        bodyBatteryChange: toInt(raw.bodyBatteryChange),
        restingHR: toInt(raw.restingHeartRate),
        hrvOvernight: toFloat(raw.avgOvernightHrv),
        sleepScoreDetails: sleepScoreDetails ?? undefined,
      },
    });
    updated++;
  }

  console.log(`업데이트: ${updated}건`);
}

async function backfillDailySummary() {
  console.log("\n=== DailySummary M2 필드 backfill ===");
  const records = await prisma.dailySummary.findMany({
    where: { avgSpo2: null },
    select: { id: true, rawData: true },
  });

  console.log(`대상: ${records.length}건`);
  let updated = 0;

  for (const r of records) {
    const raw = r.rawData as Record<string, unknown> | null;
    if (!raw) continue;

    await prisma.dailySummary.update({
      where: { id: r.id },
      data: {
        avgSpo2: toFloat(raw.averageSpo2),
        lowestSpo2: toFloat(raw.lowestSpo2),
        avgRespiration: toFloat(raw.avgWakingRespirationValue),
        stressHighDuration: toMinutes(raw.highStressDuration),
        stressMediumDuration: toMinutes(raw.mediumStressDuration),
        stressLowDuration: toMinutes(raw.lowStressDuration),
        bodyBatteryCharged: toInt(raw.bodyBatteryChargedValue),
        bodyBatteryDrained: toInt(raw.bodyBatteryDrainedValue),
      },
    });
    updated++;
  }

  console.log(`업데이트: ${updated}건`);
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

function toMinutes(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : Math.round(n / 60);
}

async function main() {
  await backfillActivities();
  await backfillSleep();
  await backfillDailySummary();
  console.log("\n=== backfill 완료 ===");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
