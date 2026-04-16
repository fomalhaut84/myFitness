import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";

/**
 * reference Date에서 "KST 벽시계 기준 해당 날짜"의 [시작, 끝) UTC instant를 산출.
 *
 * - KST 날짜(Y-M-D)는 Intl.DateTimeFormat으로 서버 TZ와 무관하게 추출.
 * - 경계는 진짜 KST 00:00의 UTC instant(= Date.UTC(Y,M,D) - 9h)로 구성.
 *   → FoodLog.date(실제 UTC instant 저장)의 집계가 서버 TZ와 무관하게 정확.
 *   → DailySummary.date는 코드베이스 관례(server TZ = KST)에서 KST midnight UTC instant와
 *     동일하므로 lookup도 일치.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstDayBoundary(referenceDate: Date): {
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

  const kstMidnightUTCms = Date.UTC(y, m - 1, d) - KST_OFFSET_MS;
  const kstDayStart = new Date(kstMidnightUTCms);
  const kstDayEnd = new Date(kstMidnightUTCms + 24 * 60 * 60 * 1000);
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
