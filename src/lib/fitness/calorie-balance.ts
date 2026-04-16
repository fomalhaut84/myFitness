import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";

/**
 * 주어진 reference Date에서 KST 기준 일(day)의 [시작, 끝) UTC 경계를 산출.
 * DailySummary.date 및 FoodLog.date 집계 기준으로 사용.
 */
function kstDayBoundary(referenceDate: Date): {
  kstDayStart: Date;
  kstDayEnd: Date;
} {
  // Asia/Seoul 벽시계(wall-clock) 기준 yyyy-mm-dd
  const seoulStr = referenceDate.toLocaleString("en-US", {
    timeZone: "Asia/Seoul",
  });
  const seoul = new Date(seoulStr);
  seoul.setHours(0, 0, 0, 0);
  const kstDayStart = seoul;
  const kstDayEnd = new Date(kstDayStart);
  kstDayEnd.setDate(kstDayEnd.getDate() + 1);
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
