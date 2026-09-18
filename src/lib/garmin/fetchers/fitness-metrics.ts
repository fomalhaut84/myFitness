// #378: Garmin VO2max 일별 · 러닝 젖산역치 이력 싱크 (dataType "fitness_metrics").
// 범위를 365일 청크로 내부 분할하고 청크마다 3회 호출 (maxmet · LT HR · LT speed). 일별 엔드포인트가
// 아니라 7년 backfill 도 호출 21회 (≈1분). 파싱·병합은 parse-fitness-metrics.ts (순수).
import type { GarminConnect } from "@flow-js/garmin-connect";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { formatDate, todayKSTString, withRateLimit } from "../utils";
import {
  asRowArray,
  kstMidnight,
  mergeFitnessMetrics,
  mergeRawData,
  splitDateRange,
  type LactateThresholdRow,
  type MaxMetRow,
} from "../parse-fitness-metrics";

const MAXMET_DAILY_URL =
  "https://connectapi.garmin.com/metrics-service/metrics/maxmet/daily";
const LT_STATS_URL = "https://connectapi.garmin.com/biometric-service/stats";
const LT_QUERY = "sport=RUNNING&aggregation=daily";

/** 404 는 데이터 없음(빈 배열). 그 외(401/403/네트워크/400)는 상위로 전파해 싱크 실패로 기록. */
async function fetchRows<T>(
  client: GarminConnect,
  url: string,
  label: string,
): Promise<readonly T[]> {
  let response: unknown;
  try {
    response = await withRateLimit(() => client.get<unknown>(url));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("404")) return [];
    throw error;
  }
  if (response !== null && response !== undefined && !Array.isArray(response)) {
    // 경계 검증: 예상 밖 형태(객체/문자열)는 조용히 0건 처리하지 않고 로그로 남긴다.
    console.warn(
      `[fitness-metrics] ${label} 응답이 배열이 아님 (${typeof response}) — 0건 처리`,
    );
  }
  return asRowArray<T>(response);
}

export async function syncFitnessMetrics(
  client: GarminConnect,
  startDate: Date,
  endDate: Date,
): Promise<number> {
  let synced = 0;
  const today = todayKSTString();

  for (const chunk of splitDateRange(startDate, endDate)) {
    const start = formatDate(chunk.start);
    const end = formatDate(chunk.end);

    const maxmet = await fetchRows<MaxMetRow>(
      client,
      `${MAXMET_DAILY_URL}/${start}/${end}`,
      "maxmet",
    );
    const lthr = await fetchRows<LactateThresholdRow>(
      client,
      `${LT_STATS_URL}/lactateThresholdHeartRate/range/${start}/${end}?${LT_QUERY}`,
      "lactateThresholdHeartRate",
    );
    const ltSpeed = await fetchRows<LactateThresholdRow>(
      client,
      `${LT_STATS_URL}/lactateThresholdSpeed/range/${start}/${end}?${LT_QUERY}`,
      "lactateThresholdSpeed",
    );

    const parsed = mergeFitnessMetrics(maxmet, lthr, ltSpeed, { notAfter: today });
    if (parsed.length === 0) continue;

    // 사전 리뷰 M1: 재싱크 시 rawData 를 소스 키 단위로 병합해야 한다 (컬럼은 undefined 로 보존되는데 rawData 만
    // 통째 교체되면 일시적 빈 응답에 기존 원본이 소실). 청크의 기존 rawData 를 한 번에 읽어 병합.
    const existingRows = await prisma.fitnessMetricDaily.findMany({
      where: { date: { in: parsed.map((r) => kstMidnight(r.date)) } },
      select: { date: true, rawData: true },
    });
    const existingRaw = new Map(existingRows.map((r) => [r.date.getTime(), r.rawData]));

    for (const row of parsed) {
      try {
        const date = kstMidnight(row.date);
        const rawData = mergeRawData(
          existingRaw.get(date.getTime()),
          row.rawData,
        ) as unknown as Prisma.InputJsonValue;
        // 같은 날 VO2max 와 LT 가 겹치면 한 row 에 병합. 재싱크 시 null 필드는 undefined 로 두어
        // 기존 값을 보존한다 (스펙 §4.3).
        await prisma.fitnessMetricDaily.upsert({
          where: { date },
          update: {
            vo2maxRunning: row.vo2maxRunning ?? undefined,
            lthr: row.lthr ?? undefined,
            lthrPace: row.lthrPace ?? undefined,
            fitnessAge: row.fitnessAge ?? undefined,
            rawData,
          },
          create: {
            date,
            vo2maxRunning: row.vo2maxRunning,
            lthr: row.lthr,
            lthrPace: row.lthrPace,
            fitnessAge: row.fitnessAge,
            rawData,
          },
        });
        synced++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[fitness-metrics] ${row.date} 저장 실패:`, msg);
      }
    }
  }

  return synced;
}
