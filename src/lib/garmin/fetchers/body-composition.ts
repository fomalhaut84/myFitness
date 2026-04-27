import type { GarminConnect } from "@flow-js/garmin-connect";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { formatDate, startOfDay, toKSTDateString, todayKSTString } from "../utils";

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

      // 미래 날짜 방지 — KST 기준 비교 (서버 타임존 무관).
      // 자정 근처 KST 미래 entry가 서버 로컬 midnight 변환으로 전날로 들어가는 것 방지.
      if (toKSTDateString(entryDate) > todayKSTString()) continue;

      const weight = gramToKg(entry.weight);

      if (weight === null) continue;

      const data = {
        weight,
        bmi: toFloat(entry.bmi),
        bodyFat: toFloat(entry.bodyFat),
        muscleMass: toFloat(entry.muscleMass),
        source: "garmin" as const,
        rawData: entry as unknown as Prisma.InputJsonValue,
      };

      // M4-7: 원자적 조건부 업데이트 + create fallback으로 source="manual" 보호.
      // 1) 비-manual 레코드만 업데이트 시도 (원자적).
      const updated = await prisma.bodyComposition.updateMany({
        where: { date: dayDate, source: { not: "manual" } },
        data,
      });
      if (updated.count > 0) {
        synced++;
      } else {
        // 2) 업데이트된 게 없으면 → 레코드 자체가 없거나, manual 레코드가 있음.
        //    create 시도. unique 제약 위반(P2002)이면 manual 레코드 존재 → skip.
        try {
          await prisma.bodyComposition.create({
            data: { date: dayDate, ...data },
          });
          synced++;
        } catch (err) {
          const code = (err as { code?: string })?.code;
          if (code !== "P2002") throw err;
          // manual 레코드 존재 → 보호 (skip, synced 미증가)
        }
      }
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
