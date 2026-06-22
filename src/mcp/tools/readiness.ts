import prisma from "../prisma";
import {
  todayKST,
  yesterdayKST,
  daysAgoKST,
  todayKSTString,
} from "../../lib/garmin/utils";

interface ReadinessLabel {
  label: "optimal" | "good" | "moderate" | "fatigued" | "depleted";
  recommendation: string;
}

function classify(score: number): ReadinessLabel {
  if (score >= 90) {
    return { label: "optimal", recommendation: "고강도 훈련 가능 (인터벌, 템포)" };
  }
  if (score >= 75) {
    return { label: "good", recommendation: "중-고강도 훈련 권장 (LT 페이스, 장거리)" };
  }
  if (score >= 50) {
    return { label: "moderate", recommendation: "중강도 또는 회복주" };
  }
  if (score >= 30) {
    return { label: "fatigued", recommendation: "저강도 회복주 권장" };
  }
  return { label: "depleted", recommendation: "휴식 권장" };
}

function average(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function round(n: number | null, digits = 1): number | null {
  if (n === null) return null;
  const factor = Math.pow(10, digits);
  return Math.round(n * factor) / factor;
}

/**
 * 오늘 기준 회복 점수 + 컨텍스트.
 * - score: Garmin DailySummary.bodyBatteryHigh (0-100)
 * - label / recommendation: 5단계 강도 추천
 * - context: HRV/restingHR 7일 평균 대비 deviation, 수면 점수, 어제 트레이닝 로드
 */
export async function getReadinessScore() {
  const today = todayKST();
  const yesterday = yesterdayKST();
  const sevenDaysAgo = daysAgoKST(7);

  const [todayDaily, recentDaily, todaySleep, recentSleep, yesterdayActivities] =
    await Promise.all([
      prisma.dailySummary.findUnique({
        where: { date: today },
        select: { bodyBatteryHigh: true, restingHR: true },
      }),
      prisma.dailySummary.findMany({
        where: { date: { gte: sevenDaysAgo, lt: today } },
        select: { restingHR: true },
      }),
      prisma.sleepRecord.findUnique({
        where: { date: today },
        select: { hrvOvernight: true, restingHR: true, sleepScore: true },
      }),
      prisma.sleepRecord.findMany({
        where: { date: { gte: sevenDaysAgo, lt: today } },
        select: { hrvOvernight: true, sleepScore: true },
      }),
      prisma.activity.findMany({
        // 운영 서버 timezone이 KST일 때, fetchers/activities.ts:34의
        // `new Date(startTimeLocal)`이 KST 벽시각을 KST로 해석해 정확한 UTC instant가 됨.
        // → yesterdayKST/todayKST (KST 자정 instant) 가 정확한 어제 1일 범위.
        // UTC 환경으로 이식 시 startTime 저장 normalize 필요 (#119 wontfix close).
        where: { startTime: { gte: yesterday, lt: today } },
        select: {
          duration: true,
          intensityScore: true,
          aerobicTE: true,
          anaerobicTE: true,
        },
      }),
    ]);

  const score = todayDaily?.bodyBatteryHigh ?? null;
  const classification = score !== null ? classify(score) : null;

  const hrvToday = todaySleep?.hrvOvernight ?? null;
  const hrvAvg7d = average(recentSleep.map((r) => r.hrvOvernight));
  const hrvDeviationPct =
    hrvToday !== null && hrvAvg7d !== null && hrvAvg7d !== 0
      ? round(((hrvToday - hrvAvg7d) / hrvAvg7d) * 100, 1)
      : null;

  // restingHR: SleepRecord 우선, fallback DailySummary
  const restingHRToday = todaySleep?.restingHR ?? todayDaily?.restingHR ?? null;
  const restingHRAvg7d = average(recentDaily.map((d) => d.restingHR));
  const restingHRDeviationBpm =
    restingHRToday !== null && restingHRAvg7d !== null
      ? Math.round(restingHRToday - restingHRAvg7d)
      : null;

  const sleepScoreToday = todaySleep?.sleepScore ?? null;
  const sleepScoreAvg7d = average(recentSleep.map((r) => r.sleepScore));

  // 휴식일(empty array)과 데이터 누락(개별 필드 null)을 구분:
  // - empty array → totalIntensityScore=0, totalDurationMin=0 (휴식일 명시)
  // - 활동 있지만 개별 필드 null → 합계/최대 계산에서 그 활동만 제외
  // - max*TE는 활동 없으면 0 (휴식일 = 부하 없음)
  const isRestDay = yesterdayActivities.length === 0;

  const intensityValues = yesterdayActivities
    .map((a) => a.intensityScore)
    .filter((v): v is number => typeof v === "number");
  const totalIntensityScore = isRestDay
    ? 0
    : intensityValues.length > 0
      ? Math.round(intensityValues.reduce((a, b) => a + b, 0))
      : null;

  const totalDurationMin = isRestDay
    ? 0
    : Math.round(yesterdayActivities.reduce((a, b) => a + b.duration, 0) / 60);

  const aerobicValues = yesterdayActivities
    .map((a) => a.aerobicTE)
    .filter((v): v is number => typeof v === "number");
  const maxAerobicTE = isRestDay
    ? 0
    : aerobicValues.length > 0
      ? Math.max(...aerobicValues)
      : null;

  const anaerobicValues = yesterdayActivities
    .map((a) => a.anaerobicTE)
    .filter((v): v is number => typeof v === "number");
  const maxAnaerobicTE = isRestDay
    ? 0
    : anaerobicValues.length > 0
      ? Math.max(...anaerobicValues)
      : null;

  const payload = {
    date: todayKSTString(),
    score,
    label: classification?.label ?? null,
    recommendation: classification?.recommendation ?? null,
    context: {
      hrv: {
        today: round(hrvToday, 1),
        avg7d: round(hrvAvg7d, 1),
        deviationPct: hrvDeviationPct,
      },
      restingHR: {
        today: restingHRToday,
        avg7d: restingHRAvg7d !== null ? Math.round(restingHRAvg7d) : null,
        deviationBpm: restingHRDeviationBpm,
      },
      sleep: {
        score: sleepScoreToday,
        avg7d: sleepScoreAvg7d !== null ? Math.round(sleepScoreAvg7d) : null,
      },
      yesterdayLoad: {
        totalIntensityScore,
        totalDurationMin,
        maxAerobicTE: round(maxAerobicTE, 1),
        maxAnaerobicTE: round(maxAnaerobicTE, 1),
      },
    },
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}
