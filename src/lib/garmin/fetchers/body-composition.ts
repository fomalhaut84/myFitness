import type { GarminConnect } from "@flow-js/garmin-connect";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { formatDate, startOfDay } from "../utils";

const WEIGHT_URL =
  "https://connectapi.garmin.com/weight-service/weight/dateRange";

interface WeightEntry {
  /**
   * 사용자 로컬 (KST) wall-clock time 을 UTC 로 표기한 naive-TZ ms 값. 즉 KST 08:10 AM 재고면
   * `date = 2026-08-27T08:10:03Z` 로 옴 (실제 UTC epoch 는 아님). 미래 필터·저장 시각 비교에는
   * 사용 금지 — 오전 sync 에서 오늘 entry 를 "미래" 로 오인해 skip 하는 버그가 있었음 (#328 hotfix).
   */
  date: number;
  /** 실제 UTC epoch ms. 미래 필터/시각 비교에 사용. */
  timestampGMT?: number;
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
  // #328: Garmin `weight-service/weight/dateRange` API 는 endDate 를 exclusive 로
  // 해석하는 것으로 관찰됨 (endDate=오늘 이면 오늘 측정 entry 누락). endDate 를 하루 뒤
  // date 로 요청해 오늘 데이터 확실히 커버. entryDate > Date.now() 방어가 아래에서
  // 미래 entry (내일 측정 - 실무상 없음) 를 필터링하니 over-fetch 는 안전.
  const startStr = formatDate(startDate);
  const endInclusive = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
  const endStr = formatDate(endInclusive);

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
      // #328 hotfix: entry.date 는 KST 로컬 시각을 UTC 로 표기한 naive-TZ 값 (KST 08:10 →
      // 08:10Z). Date.now() 는 실제 UTC 라 오전 sync 에서 오늘 entry 를 "미래" 로 오인해 skip.
      // timestampGMT 가 실제 UTC epoch — 미래 필터에 사용. 폴백은 date (구식 응답 방어).
      const utcMs =
        typeof entry.timestampGMT === "number" ? entry.timestampGMT : entry.date;
      const entryDate = new Date(utcMs);
      // dayDate 계산은 KST wall-clock 기준이라 entry.date (KST-labeled) 로 파싱해도 같은
      // 결과. 다만 timestampGMT 로 파싱한 entryDate 도 startOfDay (ymdKST) 통과 시 KST
      // midnight 인스턴트로 정규화되므로 일관성 유지 위해 utcMs 재사용.
      const dayDate = startOfDay(entryDate);

      // 미래 instant 방지 (서버 타임존 무관 절대 시각 비교)
      if (entryDate.getTime() > Date.now()) continue;

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
