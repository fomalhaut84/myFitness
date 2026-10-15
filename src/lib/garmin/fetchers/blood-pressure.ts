import type { GarminConnect } from "@flow-js/garmin-connect";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { GARMIN_PROTECTED_SOURCES } from "@/lib/omron/write-policy";
import { formatDate, todayKSTString, withRateLimit } from "../utils";

const BP_URL =
  "https://connectapi.garmin.com/bloodpressure-service/bloodpressure/range";

interface BPMeasurement {
  systolic: number;
  diastolic: number;
  pulse: number | null;
  measurementTimestampLocal: string;
  measurementTimestampGMT: string;
  sourceType: string;
  category: string;
  categoryName: string;
  [key: string]: unknown;
}

interface BPDaySummary {
  startDate: string;
  endDate: string;
  highSystolic: number;
  lowSystolic: number;
  highDiastolic: number;
  lowDiastolic: number;
  numOfMeasurements: number;
  category: string;
  categoryName: string;
  measurements: BPMeasurement[];
}

interface BPResponse {
  from: string;
  until: string;
  measurementSummaries: BPDaySummary[];
  [key: string]: unknown;
}

export async function syncBloodPressure(
  client: GarminConnect,
  startDate: Date,
  endDate: Date
): Promise<number> {
  const startStr = formatDate(startDate);
  const endStr = formatDate(endDate);

  let response: BPResponse;
  try {
    response = await withRateLimit(() =>
      client.get<BPResponse>(
        `${BP_URL}/${startStr}/${endStr}?includeAll=true`
      )
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("404")) return 0;
    throw error;
  }

  if (!response?.measurementSummaries?.length) return 0;

  let synced = 0;

  for (const summary of response.measurementSummaries) {
    try {
      if (!summary.startDate || summary.numOfMeasurements === 0) continue;

      // 미래 날짜 방지 (타임존 스큐)
      if (summary.startDate > todayKSTString()) continue;

      // KST midnight UTC instant (서버 타임존 무관)
      const dayDate = new Date(`${summary.startDate}T00:00:00+09:00`);

      // 평균 맥박 계산
      const pulses = summary.measurements
        .map((m) => m.pulse)
        .filter((p): p is number => p !== null && p > 0);
      const avgPulse =
        pulses.length > 0
          ? Math.round(pulses.reduce((s, p) => s + p, 0) / pulses.length)
          : null;

      const data = {
        highSystolic: summary.highSystolic,
        lowSystolic: summary.lowSystolic,
        highDiastolic: summary.highDiastolic,
        lowDiastolic: summary.lowDiastolic,
        avgPulse,
        measureCount: summary.numOfMeasurements,
        category: summary.category ?? null,
        measurements: summary.measurements as unknown as Prisma.InputJsonValue,
        rawData: summary as unknown as Prisma.InputJsonValue,
      };

      // #514: OMRON 이 가진 날짜는 덮지 않는다 (OMRON 우선). 조건부 갱신 → 없으면 생성, 충돌 (P2002) 이면 보호 행 → skip
      const updated = await prisma.bloodPressure.updateMany({
        where: { date: dayDate, source: { notIn: [...GARMIN_PROTECTED_SOURCES] } },
        data,
      });
      if (updated.count > 0) {
        synced++;
        continue;
      }
      try {
        await prisma.bloodPressure.create({ data: { date: dayDate, ...data } });
        synced++;
      } catch (err) {
        if ((err as { code?: string })?.code !== "P2002") throw err;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn("[blood-pressure] 항목 저장 실패:", msg);
    }
  }

  return synced;
}
