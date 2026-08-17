import prisma from "../prisma";
import { aggregateRecentMacros, averageMacros } from "@/lib/nutrition/daily-macros";
import { assessMuscleLossRisk, HIGH_INTENSITY_THRESHOLD_MIN } from "@/lib/fitness/muscle-loss-risk";
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
  // Codex P2 (PR #300 14회차): risk 는 완료된 KST 7일 (today-7..today-1) 이 필요 → today-7
  // 부터 fetch. raw summaries (dailyBalances, avgDailyBalance, 연속 결손) 는 기존 7일 today
  // 포함 창 (today-6..today) 유지 — Codex 지시대로 "retain 7-day today-inclusive data".
  const kstRiskWindowStart = new Date(kstTodayMidnight.getTime() - 7 * DAY_MS);
  const kstRawWindowStart = new Date(kstTodayMidnight.getTime() - 6 * DAY_MS);
  const fourteenDaysAgo = daysAgo(13);

  const [balances, weights, latestWeightRow, activities, profile] =
    await Promise.all([
      prisma.dailySummary.findMany({
        where: { date: { gte: kstRiskWindowStart } },
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
      // Codex P2 (PR #301 20회차): risk assessor · currentWeight 는 14일 창 밖의 마지막 측정치라도
      // 유효 (사용자가 14일 이상 체중 기록 안 하면 weights 가 비어 latestWeight null 로 protein/kg
      // 판정 suppressed → HIGH/MEDIUM verdict downgrade). /nutrition 페이지와 동일하게 창 없이 최신.
      prisma.bodyComposition.findFirst({
        orderBy: { date: "desc" },
        select: { weight: true },
      }),
      prisma.activity.findMany({
        where: { startTime: { gte: kstRiskWindowStart } },
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

  // Codex P2 (PR #300 14회차): raw 요약은 today 포함 7일 (today-6..today) 만 사용.
  // 위 fetch 는 risk 를 위해 8일 (today-7..today) 을 가져오지만, 사용자에게 보여주는 요약은
  // 기존 정책 (7일 today-inclusive) 유지.
  const balancesRaw = balances.filter(
    (b) => b.date.getTime() >= kstRawWindowStart.getTime(),
  );
  // 칼로리 밸런스 요약 (balances는 orderBy date asc로 조회됨 → 시간순 보장)
  const withBalance = balancesRaw.filter(
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
  for (let i = balancesRaw.length - 1; i >= 0; i--) {
    const bal = balancesRaw[i].calorieBalance;
    if (bal === null || bal >= 0) break;
    consecutiveDeficitDays++;
  }
  for (let i = balancesRaw.length - 1; i >= 0; i--) {
    const bal = balancesRaw[i].calorieBalance;
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

  // Codex P2 (PR #301 20회차): 14일 창 밖의 last-known weight 도 허용 (risk 판정 · currentWeight
  // response). 창 안이 있으면 그것이 최신이라 결과 동일.
  const latestWeight =
    latestWeightRow?.weight ??
    (weights.length > 0 ? weights[weights.length - 1].weight : null);

  // Codex P2 (PR #300 14회차): raw 요약 활동도 today 포함 7일 유지. 8-day fetch 는 risk 계산 용.
  const activitiesRaw = activities.filter(
    (a) => a.startTime.getTime() >= kstRawWindowStart.getTime(),
  );
  const activitiesCompleted = activities.filter(
    (a) => a.startTime.getTime() < kstTodayMidnight.getTime(),
  );
  // 고강도 운동 (Z4+) 이번 주 시간.
  // Codex P2 (PR #300): 실제 Z4+Z5 시간만 카운트. intensityLabel 은 zoneDistribution 비율
  // 임계 넘으면 부여되는 라벨이라, 전체 duration 을 세면 Z1~Z3 회복 구간도 포함되어 과대 산정.
  const highIntensityActivities = activitiesRaw.filter(
    (a) =>
      a.intensityLabel === "threshold" ||
      a.intensityLabel === "interval" ||
      a.intensityLabel === "max"
  );
  // Codex P2 (PR #300 11회차): zone 누락 활동이 하나라도 있으면 카운트 과소 산정 위험.
  // 위험 판정용 입력에는 null (unknown) 로 전달. 응답 필드는 그대로 최선 추정치 노출.
  // Codex P2 (PR #300 14회차): risk 계산은 완료 7일 (activitiesCompleted) 기준. 표시 필드는
  // 여전히 today 포함 7일 (activitiesRaw) 기준 — 사용자 표시 정책 유지.
  let missingZoneCountRisk = 0;
  const highIntensitySecondsRisk = activitiesCompleted.reduce((s, a) => {
    const dist = parseZoneDistribution(a.zoneDistribution);
    if (!dist) {
      missingZoneCountRisk++;
      return s;
    }
    return s + dist.z4 + dist.z5;
  }, 0);
  // Codex P2 (PR #301 20회차): assessor 에 fractional minutes 전달 (반올림 없이). 30:20 초 →
  // 30.33 분 → assessor 가 > 30 true → 점수 반영. 이전엔 Math.round 로 30 → false negative.
  const highIntensityMinutesRiskExact = highIntensitySecondsRisk / 60;
  const highIntensitySecondsDisplay = activitiesRaw.reduce((s, a) => {
    const dist = parseZoneDistribution(a.zoneDistribution);
    if (!dist) return s;
    return s + dist.z4 + dist.z5;
  }, 0);
  const highIntensityMinutes = Math.round(highIntensitySecondsDisplay / 60);
  // Codex P2 (PR #300 13회차): measured lower bound 가 이미 threshold 초과면 known.
  const highIntensityMinutesForRisk =
    highIntensityMinutesRiskExact > HIGH_INTENSITY_THRESHOLD_MIN
      ? highIntensityMinutesRiskExact
      : missingZoneCountRisk > 0
        ? null
        : highIntensityMinutesRiskExact;

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
  // Codex P2 (PR #300 14회차): risk 는 완료된 KST 7일 필요 → 8일 fetch 후 오늘 필터.
  // raw macroSummary 는 today 포함 7일 (기존 표시 정책 유지) → 마지막 7일 slice.
  const macros8d = await aggregateRecentMacros(nowReal, 8);
  const macros7d = macros8d.slice(-7);
  const macroAvg = averageMacros(macros7d);
  // Codex P2 (PR #300 13회차): risk 평가는 완료된 KST 일자만. 오늘 부분값 (아침만 기록 등) 이
  // 7일 평균을 흔들어 임시 warning 발생하는 것 방지. UI 노출 macroSummary 는 전체 (오늘 포함) 유지.
  const todayKstYmd = macros8d.length > 0 ? macros8d[macros8d.length - 1].date : "";
  const macros7dCompleted = macros8d.filter((d) => d.date < todayKstYmd);
  const macroAvgCompleted = averageMacros(macros7dCompleted);
  // 응답에 노출하는 avg (사용자/AI 가 daysWithProtein 로 신뢰도 판단) 은 오늘 포함 raw 유지.
  const proteinPerKgRaw =
    macroAvg.avgProteinG !== null && latestWeight
      ? Math.round((macroAvg.avgProteinG / latestWeight) * 10) / 10
      : null;
  // Codex P2 (PR #300 13회차): risk assessor 는 완료된 KST 일자 기준.
  // Codex P2 (PR #301 17회차): 반올림 (Math.round(x*10)/10) 을 판정 전에 하면 threshold 근처
  // (예: 1.441 → 1.4) 에서 오답 (< 1.44 로 오탐되어 low-protein 점수 +1).
  // Codex P2 (PR #303 18회차): daily 총량 자체도 round1 로 손실 → aggregation 상류 (DailyMacros
  // proteinGRaw + MacroAverage avgProteinGRaw) 에서 unrounded 유지. 예: 100.9×6 + 101.2×1
  // 실제 100.942857 vs 반올림 100.9. 70.09kg 에서 1.44019 (safe) vs 1.43958 (false positive).
  const proteinPerKg =
    macroAvgCompleted.avgProteinGRaw !== null &&
    latestWeight &&
    macroAvgCompleted.daysWithProtein >= MIN_PROTEIN_DAYS_FOR_ASSESSMENT
      ? macroAvgCompleted.avgProteinGRaw / latestWeight
      : null;
  const proteinTarget = profile?.proteinTargetPerKg ?? 1.6;
  // Codex P2 (PR #300 13회차): 결손 평균도 완료된 KST 일자만. 오늘 부분값 (진행 중 kcal deficit) 이
  // 7일 평균을 오르내리게 해 임시 warning 발생하는 것 방지.
  // Codex P2 (PR #300 14회차): 8-day fetch 전체 (balances) 에서 오늘 필터 → 7 완료된 KST 일.
  // withBalance (balancesRaw 기반, today 포함 7일) 를 다시 필터하면 6일만 남는 off-by-one 버그.
  const withBalanceCompleted = balances.filter(
    (b): b is typeof b & { calorieBalance: number } =>
      b.date.getTime() < kstTodayMidnight.getTime() && b.calorieBalance !== null,
  );
  const avgDailyBalanceCompleted =
    withBalanceCompleted.length > 0
      ? Math.round(
          withBalanceCompleted.reduce((s, b) => s + b.calorieBalance, 0) /
            withBalanceCompleted.length,
        )
      : null;
  const deficitInput =
    avgDailyBalanceCompleted !== null &&
    withBalanceCompleted.length >= MIN_DEFICIT_DAYS_FOR_ASSESSMENT
      ? -avgDailyBalanceCompleted
      : null;
  const muscleLoss = assessMuscleLossRisk({
    weeklyCalorieDeficit: deficitInput,
    avgProteinPerKg: proteinPerKg,
    weeklyHighIntensityMin: highIntensityMinutesForRisk,
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
      dailyBalances: balancesRaw.map((b) => ({
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
      totalActivities: activitiesRaw.length,
      runCount: activitiesRaw.filter((a) =>
        a.activityType.includes("running")
      ).length,
      totalDistanceKm: Number(
        (
          activitiesRaw.reduce((s, a) => s + (a.distance ?? 0), 0) / 1000
        ).toFixed(1)
      ),
      highIntensityCount: highIntensityActivities.length,
      highIntensityMinutes,
      byIntensity: activitiesRaw.map((a) => ({
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
    // Codex P2 (PR #300 12회차): muscleLoss.risk 를 riskLevel 에 직접 반영.
    // 이전엔 warning 1건 = moderate 였는데 muscleLoss=high 도 warning 1건으로 카운트되어
    // moderate 로 downgrade → verdict 모순. muscleLoss 가 high 면 최소 high, medium 이면
    // 최소 moderate 로 승격.
    riskLevel: (() => {
      const legacyLevel =
        warnings.length >= 2 ? "high" : warnings.length === 1 ? "moderate" : "low";
      if (muscleLoss.risk === "high" || legacyLevel === "high") return "high";
      if (muscleLoss.risk === "medium" || legacyLevel === "moderate") return "moderate";
      return "low";
    })(),
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
