import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";

/**
 * 주어진 reference Date에서 KST 기준 일(day)의 [시작, 끝) UTC 경계를 산출.
 * 서버 타임존과 독립적으로 동작하도록 Intl.DateTimeFormat + Date.UTC를 사용.
 * DailySummary.date 및 FoodLog.date 집계 기준으로 사용.
 */
function kstDayBoundary(referenceDate: Date): {
  kstDayStart: Date;
  kstDayEnd: Date;
} {
  // Asia/Seoul 벽시계 기준 연/월/일 추출 (서버 TZ 무관)
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(referenceDate);
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const m = Number(parts.find((p) => p.type === "month")!.value);
  const d = Number(parts.find((p) => p.type === "day")!.value);

  // KST(=UTC+9) 00:00의 UTC 타임스탬프
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const kstDayStartMs = Date.UTC(y, m - 1, d) - KST_OFFSET_MS;
  const kstDayStart = new Date(kstDayStartMs);
  const kstDayEnd = new Date(kstDayStartMs + 24 * 60 * 60 * 1000);
  return { kstDayStart, kstDayEnd };
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
 *   - 호출자가 이미 트랜잭션에 있으면 `tx`로 동일 트랜잭션 내 실행.
 */
export async function recalculateCalorieBalance(
  referenceDate: Date,
  tx?: TxClient
): Promise<void> {
  if (tx) {
    await doRecalc(referenceDate, tx);
    return;
  }
  await prisma.$transaction(
    async (innerTx) => doRecalc(referenceDate, innerTx),
    { isolationLevel: "Serializable" }
  );
}

async function doRecalc(referenceDate: Date, tx: TxClient): Promise<void> {
  const { kstDayStart, kstDayEnd } = kstDayBoundary(referenceDate);

  const [summary, profile, intakeAgg] = await Promise.all([
    tx.dailySummary.findUnique({ where: { date: kstDayStart } }),
    tx.userProfile.findFirst(),
    tx.foodLog.aggregate({
      where: { date: { gte: kstDayStart, lt: kstDayEnd } },
      _sum: { estimatedKcal: true },
      _count: { _all: true },
    }),
  ]);

  if (!summary) return; // Garmin 싱크 전이면 skip

  const target = profile?.targetCalories ?? null;
  const active = summary.activeCalories ?? null;
  const availableCalories =
    target !== null && active !== null ? target + active : null;

  const hasFoodLogs = intakeAgg._count._all > 0;
  const estimatedIntakeCalories = hasFoodLogs
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
export async function recalculateAllCalorieBalances(): Promise<{
  processed: number;
  failed: number;
}> {
  const summaries = await prisma.dailySummary.findMany({
    select: { date: true },
    orderBy: { date: "desc" },
  });

  let processed = 0;
  let failed = 0;
  for (const s of summaries) {
    try {
      await recalculateCalorieBalance(s.date);
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
