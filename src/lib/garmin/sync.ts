import type { GarminConnect } from "@flow-js/garmin-connect";
import type { Bot } from "grammy";
import prisma from "@/lib/prisma";
import { withReauth } from "./client";
import { daysAgo, formatDate, todayKST } from "./utils";
import { notifyGarminAuthFailedIfNeeded } from "@/lib/monitoring/admin-alerts";
import { syncActivities } from "./fetchers/activities";
import { syncDailySummaries } from "./fetchers/daily-summary";
import { syncSleep } from "./fetchers/sleep";
import { syncHeartRate } from "./fetchers/heart-rate";
import { syncBodyComposition } from "./fetchers/body-composition";
import { syncBloodPressure } from "./fetchers/blood-pressure";
import { syncUserProfile } from "./fetchers/user-profile";

const INITIAL_HISTORY_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

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

  // #220: 커버 범위 [oldestFetchedDate, coveredThroughDate] 는 contiguous 로 관리.
  // atomic UPDATE 로 concurrent syncAll safe (Codex P2 PR #239).
  //
  // 규칙 (Codex P2 PR #240 #4700500769 contiguity 요구):
  //   1) 기존 범위 없음 (null) → 새 range 로 초기화.
  //   2) 새 range 가 기존 범위와 adjacent 또는 overlap → merge (min oldest, max through).
  //   3) 새 range 가 기존과 disjoint 이지만 최근 (endDate 가 today-1day 이상) → reset (recent
  //      contiguous coverage 를 canonical 로. old 는 stale.).
  //   4) disjoint + old → 무시 (기존 marker 유지).
  //
  // adjacency: date-only 이므로 [1 day] 여유. today-1day grace 는 cron 1 miss 허용.
  //
  // user_profile 은 date 없음 → skip.
  if (dataType === "user_profile") return;

  const recentThreshold = new Date(todayKST().getTime() - DAY_MS);

  await prisma.$executeRaw`
    UPDATE "SyncMetadata"
    SET
      "oldestFetchedDate" = CASE
        WHEN "oldestFetchedDate" IS NULL OR "coveredThroughDate" IS NULL THEN ${startDate}
        WHEN ${startDate}::timestamp <= "coveredThroughDate" + INTERVAL '1 day'
         AND ${endDate}::timestamp >= "oldestFetchedDate" - INTERVAL '1 day'
        THEN LEAST("oldestFetchedDate", ${startDate})
        WHEN ${endDate}::timestamp >= ${recentThreshold}::timestamp THEN ${startDate}
        ELSE "oldestFetchedDate"
      END,
      "coveredThroughDate" = CASE
        WHEN "oldestFetchedDate" IS NULL OR "coveredThroughDate" IS NULL THEN ${endDate}
        WHEN ${startDate}::timestamp <= "coveredThroughDate" + INTERVAL '1 day'
         AND ${endDate}::timestamp >= "oldestFetchedDate" - INTERVAL '1 day'
        THEN GREATEST("coveredThroughDate", ${endDate})
        WHEN ${endDate}::timestamp >= ${recentThreshold}::timestamp THEN ${endDate}
        ELSE "coveredThroughDate"
      END
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
    /**
     * #256: 각 dataType 실패 시 관리자에게 Telegram alert 발송 시도용 Bot 참조.
     * 미제공 시 알림 skip (서버 로그만). Garmin 재인증 실패 자동 감지 목적.
     */
    notifyBot?: Bot;
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

    // #209/#220: 기존 성공 sync 가 있어도 실제 fetch 커버 범위가 부족하면 강제 backfill.
    // user_profile 은 대상 아님 (스냅샷).
    //
    // 커버 범위 = [oldestFetchedDate, coveredThroughDate] (contiguous, PR #240 Codex P2).
    // shortfall 판정:
    //   1. 마이그레이션 pre-#220: coveredThroughDate 또는 oldestFetchedDate === null →
    //      record 있으면 backfill 1회 (record 없는 계정은 skip, 무한 API 호출 방지)
    //   2. lower bound: oldestFetchedDate > requiredStart → 과거 커버 부족
    //   3. upper bound: coveredThroughDate < today - 1day → 최근 gap 존재 (예: /api/sync 로
    //      옛 disjoint range 만 fetch 된 상태)
    let historyShortfall = false;
    if (
      options?.minHistoryDays &&
      hasSuccessfulSync &&
      dataType !== "user_profile"
    ) {
      const requiredStart = daysAgo(options.minHistoryDays);
      const graceThreshold = new Date(todayKST().getTime() - DAY_MS);
      if (!meta?.oldestFetchedDate || !meta?.coveredThroughDate) {
        const first = await firstRecordDate(dataType);
        if (first !== null) historyShortfall = true;
      } else if (
        meta.oldestFetchedDate > requiredStart ||
        meta.coveredThroughDate < graceThreshold
      ) {
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
      // #256: Garmin 재인증 실패 자동 감지 → 관리자 alert (rate-limited).
      // 사전 리뷰 P1: context 가 Garmin 이 명확한 이 지점에서는 dispatcher (classifyClaudeError
      // 우선) 대신 Garmin 전용 wrapper 직접 호출. classifyClaudeError 의 `unauthorized`
      // /`authentication` 패턴이 Garmin `Unauthorized` 를 claude_auth_expired 로 오분류 방지.
      // notifyBot 미제공 시 서버 로그만. 첫 실패에서 발송 후 이후 dataType 실패는 rate-limit.
      void notifyGarminAuthFailedIfNeeded(options?.notifyBot, error).catch(
        () => {},
      );
      // 하나 실패해도 나머지 진행
    }
  }

  return results;
}

export type { DataType, SyncResult };
