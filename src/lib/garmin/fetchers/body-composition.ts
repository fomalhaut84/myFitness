import type { GarminConnect } from "@flow-js/garmin-connect";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { formatDate, startOfDay } from "../utils";

const WEIGHT_URL =
  "https://connectapi.garmin.com/weight-service/weight/dateRange";

interface WeightEntry {
  date: number; // epoch ms
  weight: number; // gram
  bmi: number | null;
  bodyFat: number | null;
  muscleMass: number | null;
  sourceType: string;
  [key: string]: unknown;
}

interface WeightResponse {
  dateWeightList: WeightEntry[];
  [key: string]: unknown;
}

export async function syncBodyComposition(
  client: GarminConnect,
  startDate: Date,
  endDate: Date
): Promise<number> {
  const startStr = formatDate(startDate);
  const endStr = formatDate(endDate);

  let response: WeightResponse;
  try {
    response = await client.get<WeightResponse>(
      `${WEIGHT_URL}?startDate=${startStr}&endDate=${endStr}`
    );
  } catch (error) {
    // 404는 데이터 없음으로 처리, 그 외(401/403/네트워크)는 상위로 전파
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("404")) return 0;
    throw error;
  }

  if (!response?.dateWeightList?.length) return 0;

  let synced = 0;

  for (const entry of response.dateWeightList) {
    try {
      const entryDate = new Date(entry.date);
      const dayDate = startOfDay(entryDate);
      const weight = gramToKg(entry.weight);

      if (weight === null) continue;

      const data = {
        weight,
        bmi: toFloat(entry.bmi),
        bodyFat: toFloat(entry.bodyFat),
        muscleMass: toFloat(entry.muscleMass),
        source: "garmin",
        rawData: entry as unknown as Prisma.InputJsonValue,
      };

      // M4-7: source="manual"인 레코드는 Garmin 싱크로 덮어쓰지 않음 (수동 입력 보호).
      const existing = await prisma.bodyComposition.findUnique({
        where: { date: dayDate },
        select: { source: true },
      });
      if (existing?.source === "manual") {
        continue;
      }

      await prisma.bodyComposition.upsert({
        where: { date: dayDate },
        update: data,
        create: { date: dayDate, ...data },
      });

      synced++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[body-composition] 항목 저장 실패:`, msg);
    }
  }

  return synced;
}

function toFloat(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function gramToKg(gram: number | null | undefined): number | null {
  if (gram === null || gram === undefined) return null;
  return Math.round((gram / 1000) * 10) / 10;
}
