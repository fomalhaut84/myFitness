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

  const [balances, weights, activities, profile] =
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

  // 칼로리 밸런스 요약 (balances는 orderBy date asc로 조회됨 → 시간순 보장)
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

  // 연속 결손 일수 + 연속 심한 결손(>750) 일수 (최근부터 역순)
  let consecutiveDeficitDays = 0;
  let consecutiveOver750 = 0;
  // 심한 결손 연속: 최근부터 < -750인 날만 카운트, 그 외(경미한 결손/잉여)에서 즉시 종료
  for (let i = withBalance.length - 1; i >= 0; i--) {
    if (withBalance[i].calorieBalance < -750) {
      consecutiveOver750++;
    } else {
      break;
    }
  }
  // 결손 연속: 최근부터 < 0인 날 카운트
  for (let i = withBalance.length - 1; i >= 0; i--) {
    if (withBalance[i].calorieBalance < 0) {
      consecutiveDeficitDays++;
    } else {
      break;
    }
  }

  // 체중 변화: 7일 이동평균 기반 (endpoint 노이즈 방지).
  // 14일 데이터에서 7일 이동평균 계산 → 7일 전 평균과 최신 평균 비교.
  const DAY_MS = 24 * 60 * 60 * 1000;
  function movingAvgAt(targetDate: Date, windowDays: number): number | null {
    const startMs = targetDate.getTime() - (windowDays - 1) * DAY_MS;
    const inWindow = weights.filter(
      (w) =>
        w.date.getTime() >= startMs && w.date.getTime() <= targetDate.getTime()
    );
    if (inWindow.length === 0) return null;
    return inWindow.reduce((s, w) => s + w.weight, 0) / inWindow.length;
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const sevenDaysAgoDate = new Date(now.getTime() - 7 * DAY_MS);
  const maLatest = movingAvgAt(now, 7);
  const maPrev = movingAvgAt(sevenDaysAgoDate, 7);
  const weight7d =
    maLatest !== null && maPrev !== null
      ? {
          avgPrev: Number(maPrev.toFixed(2)),
          avgLatest: Number(maLatest.toFixed(2)),
          changeKg: Number((maPrev - maLatest).toFixed(2)), // 양수 = 감량
        }
      : null;

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
      dailyBalances: balances.map((b) => ({
        date: b.date.toISOString().slice(0, 10),
        intake: b.estimatedIntakeCalories,
        available: b.availableCalories,
        active: b.activeCalories,
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
