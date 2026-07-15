import type { GarminConnect } from "@flow-js/garmin-connect";
import prisma from "@/lib/prisma";
import { withReauth } from "./client";
import { daysAgo, formatDate, todayKST } from "./utils";
import { syncActivities } from "./fetchers/activities";
import { syncDailySummaries } from "./fetchers/daily-summary";
import { syncSleep } from "./fetchers/sleep";
import { syncHeartRate } from "./fetchers/heart-rate";
import { syncBodyComposition } from "./fetchers/body-composition";
import { syncBloodPressure } from "./fetchers/blood-pressure";
import { syncUserProfile } from "./fetchers/user-profile";

const INITIAL_HISTORY_DAYS = 365;

type DataType =
  | "daily_stats"
  | "activities"
  | "sleep"
  | "heart_rate"
  | "body_composition"
  | "blood_pressure"
  | "user_profile";

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
  blood_pressure: syncBloodPressure,
  user_profile: syncUserProfile,
};

const SYNC_ORDER: DataType[] = [
  "daily_stats",
  "activities",
  "sleep",
  "heart_rate",
  "body_composition",
  "blood_pressure",
  "user_profile",
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

/**
 * #209: dataType 별 최초 record 날짜 조회. minHistoryDays 로 backfill 판정 시 사용.
 * user_profile 은 스냅샷이라 history 개념 없음 → null.
 * Record 자체가 없으면 null (fresh DB).
 */
async function firstRecordDate(dataType: DataType): Promise<Date | null> {
  if (dataType === "user_profile") return null;
  if (dataType === "activities") {
    const r = await prisma.activity.findFirst({
      orderBy: { startTime: "asc" },
      select: { startTime: true },
    });
    return r?.startTime ?? null;
  }
  const finders: Record<
    Exclude<DataType, "user_profile" | "activities">,
    () => Promise<{ date: Date } | null>
  > = {
    daily_stats: () =>
      prisma.dailySummary.findFirst({
        orderBy: { date: "asc" },
        select: { date: true },
      }),
    sleep: () =>
      prisma.sleepRecord.findFirst({
        orderBy: { date: "asc" },
        select: { date: true },
      }),
    heart_rate: () =>
      prisma.heartRateRecord.findFirst({
        orderBy: { date: "asc" },
        select: { date: true },
      }),
    body_composition: () =>
      prisma.bodyComposition.findFirst({
        orderBy: { date: "asc" },
        select: { date: true },
      }),
    blood_pressure: () =>
      prisma.bloodPressure.findFirst({
        orderBy: { date: "asc" },
        select: { date: true },
      }),
  };
  const r = await finders[
    dataType as Exclude<DataType, "user_profile" | "activities">
  ]();
  return r?.date ?? null;
}

async function updateSyncMetadata(
  dataType: DataType,
  startDate: Date,
  endDate: Date,
  syncCount: number,
  error?: string
): Promise<void> {
  const now = new Date();

  // 표준 필드 upsert. oldestFetchedDate 는 별도 atomic UPDATE 로 처리 (Codex bot P2).
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

  // #220: oldestFetchedDate 는 atomic LEAST 로 monotonic (concurrent syncAll 시 이전 값 보존).
  // Codex bot P2 (PR #239 #4700219384): read-modify-write 로 두 sync 겹치면
  // 나중 쓰기가 더 최신 startDate 로 이전 값을 덮어써 backfill 정보를 잃음.
  // user_profile 은 date 없음 → skip.
  if (dataType === "user_profile") return;

  // 마이그레이션 seed 후보: prev=null 인 pre-#220 record 는 firstRecordDate 로 실제 커버 proxy 반영.
  // 이후 write 에서는 startDate 만으로 충분 (semantic: 실제 API 호출 범위).
  // read → candidate 계산 → SQL LEAST 갱신. 도중 concurrent 갱신은 SQL LEAST 가 안전 처리.
  const existing = await prisma.syncMetadata.findUnique({
    where: { dataType },
    select: { oldestFetchedDate: true },
  });
  let candidate: Date = startDate;
  if (existing?.oldestFetchedDate === null) {
    const first = await firstRecordDate(dataType);
    if (first !== null && first < startDate) candidate = first;
  }

  await prisma.$executeRaw`
    UPDATE "SyncMetadata"
    SET "oldestFetchedDate" = LEAST(COALESCE("oldestFetchedDate", ${candidate}), ${candidate})
    WHERE "dataType" = ${dataType}
  `;
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
    /**
     * true면 초기 싱크 안 된 타입에 대해 explicit startDate를 무시하고
     * INITIAL_HISTORY_DAYS 강제 로드. cron이 2일 윈도우만 전달하는 상황에서
     * 신규 타입(혈압 등)의 초기 히스토리를 놓치지 않도록. 기본 false.
     */
    bootstrapNewTypes?: boolean;
    /**
     * #209: 최소 보장할 history 일수. 지정 시 각 dataType 의 최초 record 가
     * `today - minHistoryDays` 이후이면 (=history 부족) startDate 를
     * `daysAgo(minHistoryDays)` 로 강제해 backfill 유도.
     *
     * 시나리오: `/api/sync` 1일 range 로 짧게 sync 한 후 lastSyncDate=today.
     * 이 상태로 weekly preSync 를 호출하면 lastSyncDate+1 부터 시작 →
     * get_pace_progression (90일), get_training_load_trend (28일) 등 도구가
     * 필요한 history 부재. minHistoryDays 로 강제 backfill.
     *
     * `bootstrapNewTypes` 와 유사하지만 대상이 다름:
     * - bootstrapNewTypes: 성공 sync 이력 자체가 없을 때 (신규 타입)
     * - minHistoryDays: 성공 sync 는 있지만 history 가 부족할 때
     * 둘 다 적용된 경우 신규 타입은 bootstrapNewTypes 로 365일, 기존 타입은
     * minHistoryDays 로 강제 backfill.
     *
     * user_profile 은 스냅샷이라 무관.
     */
    minHistoryDays?: number;
  }
): Promise<SyncResult[]> {
  // 기본 endDate: KST 기준 오늘. 미래 날짜는 각 fetcher의 calendarDate 가드가 차단.
  const endDate = options?.endDate ?? todayKST();
  const dataTypes = options?.dataTypes ?? SYNC_ORDER;
  const results: SyncResult[] = [];

  for (const dataType of dataTypes) {
    // 초기화 여부는 lastSyncDate로 판정:
    // - markSyncing/markError가 생성한 row는 lastSyncDate=epoch(0)
    // - updateSyncMetadata(성공 시)만 lastSyncDate를 실제 날짜로 설정
    // syncCount는 record 수 기반이라 0-row 성공 시에도 0이므로 부적합.
    const meta = await prisma.syncMetadata.findUnique({ where: { dataType } });
    const hasSuccessfulSync = Boolean(
      meta && meta.lastSyncDate.getTime() > 0
    );

    // #209/#220: 기존 성공 sync 가 있어도 실제 fetch 커버 window 가 부족하면 강제 backfill.
    // user_profile 은 대상 아님 (스냅샷).
    //
    // #220 판정 기준: oldestFetchedDate > requiredStart (실제 fetch 커버 기반, record 유무 무관).
    // 기존 record 는 oldestFetchedDate === null 이라 첫 실행 시 firstRecordDate fallback 으로
    // 초기화 후 upsert 로 채워짐 (다음 실행부터 정확한 판정).
    //
    // Codex bot P2 (PR #218, #4690117542): first === null (record 없는 계정) 매주 backfill
    // 무의미 → oldestFetchedDate 이 null 이거나 record 도 null 인 경우는 fetch 커버 정보가
    // 없어 판정 불가로 skip (성공 sync 이력 존재 신호를 신뢰).
    let historyShortfall = false;
    if (
      options?.minHistoryDays &&
      hasSuccessfulSync &&
      dataType !== "user_profile"
    ) {
      const requiredStart = daysAgo(options.minHistoryDays);
      const coveredFrom =
        meta?.oldestFetchedDate ?? (await firstRecordDate(dataType));
      if (coveredFrom && coveredFrom > requiredStart) {
        historyShortfall = true;
      }
    }

    let startDate: Date;
    if (!hasSuccessfulSync && options?.bootstrapNewTypes) {
      // 신규 타입 + bootstrap 모드 (cron): 365일 초기 로드
      startDate = daysAgo(INITIAL_HISTORY_DAYS);
    } else if (historyShortfall && options?.minHistoryDays) {
      // #209: 기존 타입 + history 부족 → minHistoryDays 만큼 backfill.
      // explicit startDate 를 override 하지 않으려면 min(startDate, requiredStart) 를
      // 취해야 하나, minHistoryDays 사용 시엔 대개 명시 startDate 없음 (cron).
      startDate = daysAgo(options.minHistoryDays);
      console.log(
        `[${dataType}] history 부족 감지 (minHistoryDays=${options.minHistoryDays}) → backfill`,
      );
    } else if (options?.startDate) {
      // 명시 startDate 우선 (API 사용자 요청 등 의도된 범위 존중)
      startDate = options.startDate;
    } else if (hasSuccessfulSync) {
      // 기본: 증분 싱크 (lastSyncDate + 1)
      startDate = await getStartDate(dataType);
    } else {
      // 신규 타입 + 명시 없음: 365일
      startDate = daysAgo(INITIAL_HISTORY_DAYS);
    }

    // user_profile은 날짜 범위 무관 (스냅샷 동기화) → "이미 최신" skip 제외
    if (startDate > endDate && dataType !== "user_profile") {
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

      await updateSyncMetadata(dataType, startDate, endDate, synced);
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
