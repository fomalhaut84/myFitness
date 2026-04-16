import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import defaultPrisma from "@/lib/prisma";

/** Serializable 트랜잭션 재시도 상수 */
const MAX_RETRY = 3;
const RETRY_DELAY_MS = 50;

/**
 * reference Date에서 다음 3가지 시각값을 산출:
 *
 * 1. `summaryKey` — DailySummary 조회용 key. sync 파이프라인의 저장 관례와 정합.
 *    `startOfDay(date)` = 서버 로컬 midnight of (KST wall-clock 날짜). 서버 TZ에 의존.
 * 2. `kstDayStart` / `kstDayEnd` — FoodLog.date(실제 UTC instant) 집계용 경계.
 *    진짜 KST 00:00 UTC instant(= Date.UTC(Y,M,D) - 9h)로 서버 TZ와 무관하게 정확.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstDayBoundary(referenceDate: Date): {
  summaryKey: Date;
  kstDayStart: Date;
  kstDayEnd: Date;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(referenceDate);
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const m = Number(parts.find((p) => p.type === "month")!.value);
  const d = Number(parts.find((p) => p.type === "day")!.value);

  // DailySummary.date 저장 관례: 서버 로컬 midnight of KST 날짜
  const summaryKey = new Date(y, m - 1, d, 0, 0, 0, 0);

  // FoodLog 집계 경계: 진짜 KST 00:00 UTC instant
  const kstMidnightUTCms = Date.UTC(y, m - 1, d) - KST_OFFSET_MS;
  const kstDayStart = new Date(kstMidnightUTCms);
  const kstDayEnd = new Date(kstMidnightUTCms + 24 * 60 * 60 * 1000);

  return { summaryKey, kstDayStart, kstDayEnd };
}

type TxClient = Prisma.TransactionClient;

/**
 * 특정 날짜의 칼로리 밸런스를 재계산하여 DailySummary에 저장.
 *
 * 계산식:
 *   availableCalories = targetCalories(프로필) + activeCalories(Garmin)
 *   estimatedIntakeCalories = SUM(FoodLog.estimatedKcal) for the KST day
 *   calorieBalance = intake - available  (음수 = 결손/감량, 양수 = 잉여)
 *
 * 동시성 보호:
 *   - Serializable 트랜잭션으로 aggregate-then-update 간 race(lost update) 차단.
 *   - 직렬화 충돌(P2034) 시 자동 재시도 (최대 MAX_RETRY 회).
 *   - 호출자가 이미 트랜잭션에 있으면 `tx`로 동일 트랜잭션 내 실행.
 *
 * @param client — 사용할 PrismaClient. 봇 등 별도 client가 있는 프로세스에서 전달.
 */
export async function recalculateCalorieBalance(
  referenceDate: Date,
  tx?: TxClient,
  client?: PrismaClient
): Promise<void> {
  if (tx) {
    await doRecalc(referenceDate, tx);
    return;
  }
  const db = client ?? defaultPrisma;
  await withSerializableRetry(db, (innerTx) =>
    doRecalc(referenceDate, innerTx)
  );
}

/** Serializable 트랜잭션 + 직렬화 충돌(P2034) 자동 재시도 */
async function withSerializableRetry(
  db: PrismaClient,
  fn: (tx: TxClient) => Promise<void>
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      await (db as unknown as typeof defaultPrisma).$transaction(
        async (tx) => fn(tx),
        { isolationLevel: "Serializable" }
      );
      return;
    } catch (err) {
      const isSerializationFailure =
        err instanceof Error && err.message.includes("P2034");
      if (!isSerializationFailure || attempt === MAX_RETRY) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
}

async function doRecalc(referenceDate: Date, tx: TxClient): Promise<void> {
  const { summaryKey, kstDayStart, kstDayEnd } = kstDayBoundary(referenceDate);

  const [summary, profile, intakeAgg] = await Promise.all([
    tx.dailySummary.findUnique({ where: { date: summaryKey } }),
    tx.userProfile.findFirst(),
    // estimatedKcal이 있는 로그만 집계. null인 로그(예: 봇 미추정)는 섭취 계산에서 제외.
    tx.foodLog.aggregate({
      where: {
        date: { gte: kstDayStart, lt: kstDayEnd },
        estimatedKcal: { not: null },
      },
      _sum: { estimatedKcal: true },
      _count: { _all: true },
    }),
  ]);

  if (!summary) return; // Garmin 싱크 전이면 skip

  const target = profile?.targetCalories ?? null;
  const active = summary.activeCalories ?? null;
  const availableCalories =
    target !== null && active !== null ? target + active : null;

  // kcal이 집계된 로그가 하나도 없으면 intake = null (0 kcal로 표시하지 않음)
  const hasCountedLogs = intakeAgg._count._all > 0;
  const estimatedIntakeCalories = hasCountedLogs
    ? (intakeAgg._sum.estimatedKcal ?? 0)
    : null;

  const calorieBalance =
    estimatedIntakeCalories !== null && availableCalories !== null
      ? estimatedIntakeCalories - availableCalories
      : null;

  await tx.dailySummary.update({
    where: { id: summary.id },
    data: {
      availableCalories,
      estimatedIntakeCalories,
      calorieBalance,
    },
  });
}

/**
 * 모든 DailySummary의 칼로리 밸런스를 재계산.
 * UserProfile.targetCalories 변경 등 전역 파라미터가 바뀌었을 때 호출.
 * 각 날짜별로 독립 트랜잭션으로 실행하여 부분 실패 시 전체 중단되지 않음.
 */
export async function recalculateAllCalorieBalances(
  client?: PrismaClient
): Promise<{
  processed: number;
  failed: number;
}> {
  const db = client ?? defaultPrisma;
  const summaries = await db.dailySummary.findMany({
    select: { date: true },
    orderBy: { date: "desc" },
  });

  let processed = 0;
  let failed = 0;
  for (const s of summaries) {
    try {
      await recalculateCalorieBalance(s.date, undefined, db);
      processed++;
    } catch (err) {
      failed++;
      console.error(
        "[calorie-balance] 재계산 실패",
        s.date.toISOString(),
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  return { processed, failed };
}
