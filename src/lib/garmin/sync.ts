import type { GarminConnect } from "@flow-js/garmin-connect";
import prisma from "@/lib/prisma";
import { withReauth } from "./client";
import { daysAgo, formatDate, todayKST } from "./utils";
import { syncActivities } from "./fetchers/activities";
import { syncDailySummaries } from "./fetchers/daily-summary";
import { syncSleep } from "./fetchers/sleep";
import { syncHeartRate } from "./fetchers/heart-rate";
import { syncBodyComposition } from "./fetchers/body-composition";

const INITIAL_HISTORY_DAYS = 365;

type DataType =
  | "daily_stats"
  | "activities"
  | "sleep"
  | "heart_rate"
  | "body_composition";

interface SyncResult {
  dataType: DataType;
  synced: number;
  error?: string;
}

const SYNC_FNS: Record<
  DataType,
  (client: GarminConnect, start: Date, end: Date) => Promise<number>
> = {
  daily_stats: syncDailySummaries,
  activities: syncActivities,
  sleep: syncSleep,
  heart_rate: syncHeartRate,
  body_composition: syncBodyComposition,
};

const SYNC_ORDER: DataType[] = [
  "daily_stats",
  "activities",
  "sleep",
  "heart_rate",
  "body_composition",
];

async function getStartDate(dataType: DataType): Promise<Date> {
  const meta = await prisma.syncMetadata.findUnique({
    where: { dataType },
  });

  if (meta?.lastSyncDate) {
    // 마지막 싱크 날짜 다음 날부터
    const next = new Date(meta.lastSyncDate);
    next.setDate(next.getDate() + 1);
    return next;
  }

  // 초기 로드: 365일 전부터
  return daysAgo(INITIAL_HISTORY_DAYS);
}

async function updateSyncMetadata(
  dataType: DataType,
  endDate: Date,
  syncCount: number,
  error?: string
): Promise<void> {
  const now = new Date();

  await prisma.syncMetadata.upsert({
    where: { dataType },
    update: {
      lastSyncAt: now,
      lastSyncDate: endDate,
      syncCount: { increment: syncCount },
      status: error ? "error" : "idle",
      errorMessage: error ?? null,
    },
    create: {
      dataType,
      lastSyncAt: now,
      lastSyncDate: endDate,
      syncCount,
      status: error ? "error" : "idle",
      errorMessage: error ?? null,
    },
  });
}

async function markError(
  dataType: DataType,
  errorMessage: string
): Promise<void> {
  await prisma.syncMetadata.upsert({
    where: { dataType },
    update: { status: "error", errorMessage },
    create: {
      dataType,
      lastSyncAt: new Date(),
      lastSyncDate: new Date(0),
      status: "error",
      errorMessage,
    },
  });
}

async function markSyncing(dataType: DataType): Promise<void> {
  await prisma.syncMetadata.upsert({
    where: { dataType },
    update: { status: "syncing", errorMessage: null },
    create: {
      dataType,
      lastSyncAt: new Date(),
      lastSyncDate: new Date(0),
      status: "syncing",
    },
  });
}

export async function syncAll(
  options?: {
    startDate?: Date;
    endDate?: Date;
    dataTypes?: DataType[];
  }
): Promise<SyncResult[]> {
  // 기본 endDate: KST 기준 오늘
  const endDate = options?.endDate ?? todayKST();
  const dataTypes = options?.dataTypes ?? SYNC_ORDER;
  const results: SyncResult[] = [];

  for (const dataType of dataTypes) {
    const startDate = options?.startDate ?? (await getStartDate(dataType));

    if (startDate > endDate) {
      console.log(`[${dataType}] 이미 최신 상태 (${formatDate(startDate)}까지 싱크 완료)`);
      results.push({ dataType, synced: 0 });
      continue;
    }

    console.log(
      `[${dataType}] 싱크 시작: ${formatDate(startDate)} ~ ${formatDate(endDate)}`
    );

    await markSyncing(dataType);

    try {
      const synced = await withReauth((client) =>
        SYNC_FNS[dataType](client, startDate, endDate)
      );

      await updateSyncMetadata(dataType, endDate, synced);
      console.log(`[${dataType}] 싱크 완료: ${synced}건`);
      results.push({ dataType, synced });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      // 실패 시 lastSyncDate를 업데이트하지 않음 → 다음 싱크에서 같은 범위 재시도
      await markError(dataType, message);
      console.error(`[${dataType}] 싱크 실패:`, message);
      results.push({ dataType, synced: 0, error: message });
      // 하나 실패해도 나머지 진행
    }
  }

  return results;
}

export type { DataType, SyncResult };
