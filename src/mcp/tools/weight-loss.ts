import prisma from "../prisma";

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * 최근 7일 체중·칼로리·운동 통합 요약.
 * 감량 진행도 평가, 근손실 위험 판단, 리포트 작성에 사용.
 */
export async function getWeightLossStatus() {
  const sevenDaysAgo = daysAgo(7);
  const fourteenDaysAgo = daysAgo(14);

  const [balances, weights, recentWeights, activities, profile] =
    await Promise.all([
      prisma.dailySummary.findMany({
        where: { date: { gte: sevenDaysAgo } },
        select: {
          date: true,
          calorieBalance: true,
          estimatedIntakeCalories: true,
          availableCalories: true,
          activeCalories: true,
        },
        orderBy: { date: "asc" },
      }),
      prisma.bodyComposition.findMany({
        where: { date: { gte: fourteenDaysAgo } },
        select: { date: true, weight: true },
        orderBy: { date: "asc" },
      }),
      prisma.bodyComposition.findMany({
        where: { date: { gte: sevenDaysAgo } },
        select: { date: true, weight: true },
        orderBy: { date: "asc" },
      }),
      prisma.activity.findMany({
        where: { startTime: { gte: sevenDaysAgo } },
        select: {
          name: true,
          activityType: true,
          startTime: true,
          distance: true,
          duration: true,
          calories: true,
          intensityLabel: true,
          estimatedZone: true,
        },
        orderBy: { startTime: "desc" },
      }),
      prisma.userProfile.findFirst(),
    ]);

  // 칼로리 밸런스 요약
  const withBalance = balances.filter((b) => b.calorieBalance !== null) as {
    date: Date;
    calorieBalance: number;
  }[];
  const avgDailyBalance =
    withBalance.length > 0
      ? Math.round(
          withBalance.reduce((s, b) => s + b.calorieBalance, 0) /
            withBalance.length
        )
      : null;

  // 연속 결손 일수 (최근부터 역순으로 카운트)
  let consecutiveDeficitDays = 0;
  let consecutiveOver750 = 0;
  for (let i = withBalance.length - 1; i >= 0; i--) {
    if (withBalance[i].calorieBalance < 0) {
      consecutiveDeficitDays++;
      if (withBalance[i].calorieBalance < -750) consecutiveOver750++;
    } else {
      break;
    }
  }

  // 체중 변화
  const weight7d =
    recentWeights.length >= 2
      ? {
          first: recentWeights[0].weight,
          last: recentWeights[recentWeights.length - 1].weight,
          changeKg: Number(
            (
              recentWeights[0].weight -
              recentWeights[recentWeights.length - 1].weight
            ).toFixed(2)
          ),
        }
      : null;

  // 14일 체중으로 이동평균 계산
  const latestWeight = weights.length > 0 ? weights[weights.length - 1].weight : null;

  // 고강도 운동 (Z4+) 이번 주 시간
  const highIntensityActivities = activities.filter(
    (a) =>
      a.intensityLabel === "threshold" ||
      a.intensityLabel === "interval" ||
      a.intensityLabel === "max"
  );
  const highIntensityMinutes = highIntensityActivities.reduce(
    (s, a) => s + Math.round(a.duration / 60),
    0
  );

  // 경고 판정
  const warnings: string[] = [];
  if (consecutiveOver750 >= 3 && highIntensityActivities.length > 0) {
    warnings.push(
      `근손실/오버트레이닝 위험: 3일 연속 결손 > 750kcal + 고강도 운동(${highIntensityActivities.map((a) => a.name).join(", ")})`
    );
  }
  if (weight7d && weight7d.changeKg > 1.0) {
    warnings.push(
      `감량 속도 과다: 7일간 ${weight7d.changeKg}kg 감량 (권장 주 0.5kg)`
    );
  }
  if (avgDailyBalance !== null && avgDailyBalance < -1000) {
    warnings.push(
      `과도한 칼로리 결손: 일평균 ${avgDailyBalance}kcal (피로/근손실 위험)`
    );
  }

  // 예상 주간 감량
  const projectedWeeklyLossKg =
    avgDailyBalance !== null && avgDailyBalance < 0
      ? Number(((Math.abs(avgDailyBalance) * 7) / 7700).toFixed(2))
      : 0;

  const response = {
    _context:
      "최근 7일 체중/칼로리/운동 통합 요약. 경고(warnings)가 있으면 리포트에 반드시 반영하세요.",
    period: "최근 7일",
    calorieSummary: {
      avgDailyBalance,
      daysWithData: withBalance.length,
      consecutiveDeficitDays,
      consecutiveOver750Days: consecutiveOver750,
      dailyBalances: withBalance.map((b) => ({
        date: b.date.toISOString().slice(0, 10),
        balance: b.calorieBalance,
      })),
    },
    weightSummary: {
      currentWeight: latestWeight,
      targetWeight: profile?.targetWeight ?? null,
      targetCalories: profile?.targetCalories ?? null,
      change7d: weight7d,
      projectedWeeklyLossKg,
    },
    activitySummary: {
      totalActivities: activities.length,
      runCount: activities.filter((a) =>
        a.activityType.includes("running")
      ).length,
      totalDistanceKm: Number(
        (
          activities.reduce((s, a) => s + (a.distance ?? 0), 0) / 1000
        ).toFixed(1)
      ),
      highIntensityCount: highIntensityActivities.length,
      highIntensityMinutes,
      byIntensity: activities.map((a) => ({
        name: a.name,
        type: a.activityType,
        date: a.startTime.toISOString().slice(0, 10),
        label: a.intensityLabel,
        zone: a.estimatedZone,
      })),
    },
    warnings,
    riskLevel:
      warnings.length >= 2
        ? "high"
        : warnings.length === 1
          ? "moderate"
          : "low",
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}
