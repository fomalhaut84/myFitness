/**
 * 체중감량 분석 유틸 (M4-6).
 *
 * - movingAverage: N일 이동평균 계산 (센트럴이 아닌 단말 기준, 과거 N-1일 포함)
 * - projectWeightLossKg: 일평균 칼로리 결손으로 주간 예상 감량 추정
 * - weeklyAverage: 최근 N일 평균
 */

const KCAL_PER_KG_FAT = 7700;

export interface WeightRecord {
  date: Date;
  weight: number;
}

export interface MovingAvgPoint {
  date: Date;
  avg: number;
}

/**
 * 단말(trailing) 기준 N일 이동평균.
 * 창 내 최소 1개 데이터가 있어야 산출.
 */
export function movingAverage(
  records: readonly WeightRecord[],
  window: number
): MovingAvgPoint[] {
  if (window <= 0) return [];
  const sorted = [...records].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );
  const result: MovingAvgPoint[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = sorted.slice(start, i + 1);
    if (slice.length === 0) continue;
    const sum = slice.reduce((s, r) => s + r.weight, 0);
    result.push({
      date: sorted[i].date,
      avg: Number((sum / slice.length).toFixed(2)),
    });
  }
  return result;
}

/**
 * 일평균 결손(kcal/day, 음수) → 주간 예상 감량(kg).
 * 1kg 체지방 ≈ 7700kcal 가정.
 */
export function projectWeightLossKg(avgDailyDeficit: number): number {
  // avgDailyDeficit은 음수일 때 감량 → 절대값 사용
  const weeklyDeficit = Math.abs(avgDailyDeficit) * 7;
  return Number((weeklyDeficit / KCAL_PER_KG_FAT).toFixed(2));
}

export interface WeeklySummary {
  weekStart: Date;
  weekEnd: Date;
  avgDailyBalance: number | null; // kcal/day (음수 = 결손)
  daysWithData: number;
  projectedLossKg: number | null; // 주간 예상 감량 (+ = 감량, 0/null = 데이터 부족)
  weightChangeKg: number | null; // 실제 체중 변화 (+ = 감소)
  actualKg: { first: number; last: number } | null;
}

/** 최근 7일(또는 지정 기간)의 평균 결손 및 실제 체중 변화 요약 */
export function summarizeWeek(args: {
  balances: readonly { date: Date; calorieBalance: number | null }[];
  weights: readonly WeightRecord[];
  weekStart: Date;
  weekEnd: Date;
}): WeeklySummary {
  const inRange = <T extends { date: Date }>(r: T) =>
    r.date.getTime() >= args.weekStart.getTime() &&
    r.date.getTime() < args.weekEnd.getTime();

  const bals = args.balances
    .filter(inRange)
    .filter((b) => b.calorieBalance !== null) as {
    date: Date;
    calorieBalance: number;
  }[];
  const daysWithData = bals.length;
  const avgDailyBalance =
    daysWithData > 0
      ? Math.round(bals.reduce((s, b) => s + b.calorieBalance, 0) / daysWithData)
      : null;
  const projectedLossKg =
    avgDailyBalance !== null && avgDailyBalance < 0
      ? projectWeightLossKg(avgDailyBalance)
      : avgDailyBalance !== null
        ? 0
        : null;

  const weekWeights = args.weights
    .filter(inRange)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const actualKg =
    weekWeights.length >= 2
      ? {
          first: weekWeights[0].weight,
          last: weekWeights[weekWeights.length - 1].weight,
        }
      : null;
  const weightChangeKg =
    actualKg !== null
      ? Number((actualKg.first - actualKg.last).toFixed(2))
      : null;

  return {
    weekStart: args.weekStart,
    weekEnd: args.weekEnd,
    avgDailyBalance,
    daysWithData,
    projectedLossKg,
    weightChangeKg,
    actualKg,
  };
}

/** 목표 진행도 계산 (백분율 0~100) */
export function computeGoalProgress(args: {
  currentWeight: number | null;
  startWeight: number | null; // 감량 시작 시점 체중 (첫 기록 등)
  targetWeight: number | null;
}): {
  remainingKg: number | null;
  lostKg: number | null;
  percentComplete: number | null;
} {
  const { currentWeight, startWeight, targetWeight } = args;
  if (currentWeight === null || targetWeight === null) {
    return { remainingKg: null, lostKg: null, percentComplete: null };
  }
  const remaining = Number((currentWeight - targetWeight).toFixed(2));
  if (startWeight === null) {
    return { remainingKg: remaining, lostKg: null, percentComplete: null };
  }
  const totalToLose = startWeight - targetWeight;
  if (totalToLose <= 0) {
    // 이미 목표 달성 또는 역방향
    return {
      remainingKg: remaining,
      lostKg: Number((startWeight - currentWeight).toFixed(2)),
      percentComplete: remaining <= 0 ? 100 : 0,
    };
  }
  const lost = startWeight - currentWeight;
  const percent = Math.max(0, Math.min(100, (lost / totalToLose) * 100));
  return {
    remainingKg: remaining,
    lostKg: Number(lost.toFixed(2)),
    percentComplete: Number(percent.toFixed(1)),
  };
}
