import prisma from "../prisma";
import { aggregateRecentMacros, averageMacros } from "@/lib/nutrition/daily-macros";
import { assessMuscleLossRisk } from "@/lib/fitness/muscle-loss-risk";
import { parseZoneDistribution } from "@/lib/fitness/intensity";
import { ymdKST } from "@/lib/garmin/utils";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Codex P2 (PR #300 10회차): balances/activities/macros 를 동일 KST 창으로 정렬.
// 이전 daysAgo(6) 은 UTC midnight 기준이라 서버 UTC 에서 00:00~09:00 KST 사이엔 KST 첫 9시간 +
// DailySummary 첫 KST row 를 놓치고, 그 외 시간대엔 이전 KST 하루가 창에 포함됨.
function kstMidnightUTC(referenceDate: Date): Date {
  const [y, m, d] = ymdKST(referenceDate).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - KST_OFFSET_MS);
}

// Codex P2 (PR #300): protein g/kg 을 risk assessor 로 넘길 최소 데이터 커버리지.
// daysWithProtein 이 이 미만이면 표본이 얇아 오해 위험 → 대신 null (데이터 부족) 로 전달.
const MIN_PROTEIN_DAYS_FOR_ASSESSMENT = 4;
// Codex P2 (PR #300 6회차): 결손 데이터도 동일 gate.
const MIN_DEFICIT_DAYS_FOR_ASSESSMENT = 4;

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
  // Codex P2 (PR #300 10회차): balances/activities 는 KST 창으로 정렬 (macros 와 동일).
  // weights (이동평균) 는 기존 daysAgo 유지 — 서로 다른 시맨틱, 이번 스코프 외.
  const nowReal = new Date();
  const kstTodayMidnight = kstMidnightUTC(nowReal);
  const kstSevenDaysAgo = new Date(kstTodayMidnight.getTime() - 6 * DAY_MS);
  const fourteenDaysAgo = daysAgo(13);

  const [balances, weights, activities, profile] =
    await Promise.all([
      prisma.dailySummary.findMany({
        where: { date: { gte: kstSevenDaysAgo } },
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
        where: { startTime: { gte: kstSevenDaysAgo } },
        select: {
          name: true,
          activityType: true,
          startTime: true,
          distance: true,
          duration: true,
          calories: true,
          intensityLabel: true,
          estimatedZone: true,
          // Codex P2 (PR #300): 실제 Z4/Z5 초를 합해야 함 (activity duration 전체를 세면 과대 산정).
          zoneDistribution: true,
          // #267: 코스 태그도 노출 (AI 가 코스별 반복 러닝 인식)
          routeTag: true,
        },
        orderBy: { startTime: "desc" },
      }),
      prisma.userProfile.findFirst(),
    ]);

  // 칼로리 밸런스 요약 (balances는 orderBy date asc로 조회됨 → 시간순 보장)
  const withBalance = balances.filter(
    (b): b is typeof b & { calorieBalance: number } =>
      b.calorieBalance !== null
  );
  const avgDailyBalance =
    withBalance.length > 0
      ? Math.round(
          withBalance.reduce((s, b) => s + b.calorieBalance, 0) /
            withBalance.length
        )
      : null;

  // 연속 결손/심한 결손 일수 (최근부터 역순).
  // null(데이터 없는 날)은 연속 끊김으로 처리 — 건너뛰지 않음.
  let consecutiveDeficitDays = 0;
  let consecutiveOver750 = 0;
  for (let i = balances.length - 1; i >= 0; i--) {
    const bal = balances[i].calorieBalance;
    if (bal === null || bal >= 0) break;
    consecutiveDeficitDays++;
  }
  for (let i = balances.length - 1; i >= 0; i--) {
    const bal = balances[i].calorieBalance;
    if (bal === null || bal >= -750) break;
    consecutiveOver750++;
  }

  // 체중 변화: 7일 이동평균 기반 (endpoint 노이즈 방지).
  // 14일 데이터에서 7일 이동평균 계산 → 7일 전 평균과 최신 평균 비교.
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

  // 고강도 운동 (Z4+) 이번 주 시간.
  // Codex P2 (PR #300): 실제 Z4+Z5 시간만 카운트. intensityLabel 은 zoneDistribution 비율
  // 임계 넘으면 부여되는 라벨이라, 전체 duration 을 세면 Z1~Z3 회복 구간도 포함되어 과대 산정.
  const highIntensityActivities = activities.filter(
    (a) =>
      a.intensityLabel === "threshold" ||
      a.intensityLabel === "interval" ||
      a.intensityLabel === "max"
  );
  const highIntensitySeconds = activities.reduce((s, a) => {
    const dist = parseZoneDistribution(a.zoneDistribution);
    if (!dist) return s;
    return s + dist.z4 + dist.z5;
  }, 0);
  const highIntensityMinutes = Math.round(highIntensitySeconds / 60);

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

  // #299 (M14 Phase 2 #3): 매크로 요약 + 근손실 위험 평가.
  // nowReal (파일 상단에서 획득한 실시간 timestamp) 을 사용해 KST 계산 안정.
  const macros7d = await aggregateRecentMacros(nowReal, 7);
  const macroAvg = averageMacros(macros7d);
  // Codex P2 (PR #300): daysWithProtein 이 표본 미만이면 얇은 표본으로 오해 유도.
  const proteinPerKgRaw =
    macroAvg.avgProteinG !== null && latestWeight
      ? Math.round((macroAvg.avgProteinG / latestWeight) * 10) / 10
      : null;
  const proteinPerKg =
    macroAvg.daysWithProtein >= MIN_PROTEIN_DAYS_FOR_ASSESSMENT ? proteinPerKgRaw : null;
  const proteinTarget = profile?.proteinTargetPerKg ?? 1.6;
  // Codex P2 (PR #300): 결손 데이터 자체가 없으면 null 로 전달 (0 취급 금지).
  // Codex P2 (PR #300 6회차): 커버리지 gate — 표본 얇으면 null (risk 오판 방지).
  const deficitInput =
    avgDailyBalance !== null && withBalance.length >= MIN_DEFICIT_DAYS_FOR_ASSESSMENT
      ? -avgDailyBalance
      : null;
  const muscleLoss = assessMuscleLossRisk({
    weeklyCalorieDeficit: deficitInput,
    avgProteinPerKg: proteinPerKg,
    weeklyHighIntensityMin: highIntensityMinutes,
    proteinTargetPerKg: proteinTarget,
    bodyWeightKg: latestWeight,
  });
  // 근손실 verdict 를 warnings 에 반영 (기존 ad-hoc 체크와 별도 · 러너 특화 지표).
  if (muscleLoss.risk === "high") {
    warnings.push(
      `근손실 위험 HIGH (${muscleLoss.reasons.join(" / ")}) → ${muscleLoss.recommendations.join(" / ")}`,
    );
  } else if (muscleLoss.risk === "medium") {
    warnings.push(
      `근손실 위험 MEDIUM (${muscleLoss.reasons.join(" / ")})`,
    );
  }

  const response = {
    _context:
      "최근 7일 체중/칼로리/운동/매크로 통합 요약. 경고(warnings)가 있으면 리포트에 반드시 반영하세요.",
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
        routeTag: a.routeTag,
      })),
    },
    // #299: 매크로 시계열 + 러너 근손실 위험 verdict.
    macroSummary: {
      avgDaily: {
        kcal: macroAvg.avgKcal,
        proteinG: macroAvg.avgProteinG,
        // raw 값 노출 (AI 가 daysWithProteinData 로 신뢰도 판단). muscleLossRisk 입력에는
        // MIN_PROTEIN_DAYS_FOR_ASSESSMENT 미만이면 null 로 gated 되어 들어감.
        proteinPerKg: proteinPerKgRaw,
        proteinTargetPerKg: proteinTarget,
        carbsG: macroAvg.avgCarbsG,
        fatG: macroAvg.avgFatG,
      },
      daysWithProteinData: macroAvg.daysWithProtein,
      totalDays: macroAvg.totalDays,
      daily: macros7d.map((d) => ({
        date: d.date,
        kcal: d.kcal,
        proteinG: d.proteinG,
        carbsG: d.carbsG,
        fatG: d.fatG,
        itemCount: d.itemCount,
        missingCount: d.missingCount,
      })),
    },
    muscleLossRisk: muscleLoss,
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
