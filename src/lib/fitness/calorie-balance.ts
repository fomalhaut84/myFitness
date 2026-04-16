import prisma from "@/lib/prisma";

/**
 * 특정 날짜의 칼로리 밸런스를 재계산하여 DailySummary에 저장.
 *
 * 계산식:
 *   availableCalories = targetCalories(프로필) + activeCalories(Garmin)
 *   estimatedIntakeCalories = SUM(FoodLog.estimatedKcal) for the day
 *   calorieBalance = intake - available  (음수 = 결손/감량, 양수 = 잉여)
 *
 * 프로필/활성 칼로리/섭취 기록 중 하나라도 없으면 해당 값만 null로 저장.
 */
export async function recalculateCalorieBalance(
  date: Date
): Promise<void> {
  // 해당 날짜의 midnight 기준 (DailySummary.date는 midnight)
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const [summary, profile, foodLogs] = await Promise.all([
    prisma.dailySummary.findUnique({ where: { date: dayStart } }),
    prisma.userProfile.findFirst(),
    prisma.foodLog.findMany({
      where: { date: { gte: dayStart, lt: dayEnd } },
      select: { estimatedKcal: true },
    }),
  ]);

  if (!summary) return; // Garmin 싱크 전이면 skip

  const target = profile?.targetCalories ?? null;
  const active = summary.activeCalories ?? null;

  const availableCalories =
    target !== null && active !== null ? target + active : null;

  const hasFoodLogs = foodLogs.length > 0;
  const estimatedIntakeCalories = hasFoodLogs
    ? foodLogs.reduce((sum, f) => sum + (f.estimatedKcal ?? 0), 0)
    : null;

  const calorieBalance =
    estimatedIntakeCalories !== null && availableCalories !== null
      ? estimatedIntakeCalories - availableCalories
      : null;

  await prisma.dailySummary.update({
    where: { id: summary.id },
    data: {
      availableCalories,
      estimatedIntakeCalories,
      calorieBalance,
    },
  });
}
