import prisma from "../prisma";
import {
  todayKST,
  yesterdayKST,
  daysAgoKST,
  todayKSTString,
  ymdKST,
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

  // Activity.startTime 은 Garmin startTimeLocal 을 UTC 서버에서 naïve Date 로 저장
  // (KST 벽시각이 UTC instant 에 그대로 박힘 — src/lib/garmin/fetchers/activities.ts:34).
  // 따라서 어제 운동 조회는 KST 자정 instant(=UTC 15:00) 가 아니라 같은 naïve 형식으로 비교해야
  // KST 어제 15시 이후 운동이 누락되지 않음. 근본 수정(저장 normalize + backfill)은 별도 백로그.
  const yesterdayActivityStart = new Date(`${ymdKST(yesterday)}T00:00:00.000Z`);
  const todayActivityStart = new Date(`${ymdKST(today)}T00:00:00.000Z`);

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
        where: { startTime: { gte: yesterdayActivityStart, lt: todayActivityStart } },
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

  const intensityValues = yesterdayActivities
    .map((a) => a.intensityScore)
    .filter((v): v is number => typeof v === "number");
  const totalIntensityScore =
    intensityValues.length > 0
      ? Math.round(intensityValues.reduce((a, b) => a + b, 0))
      : null;

  const totalDurationMin =
    yesterdayActivities.length > 0
      ? Math.round(yesterdayActivities.reduce((a, b) => a + b.duration, 0) / 60)
      : null;

  const aerobicValues = yesterdayActivities
    .map((a) => a.aerobicTE)
    .filter((v): v is number => typeof v === "number");
  const maxAerobicTE = aerobicValues.length > 0 ? Math.max(...aerobicValues) : null;

  const anaerobicValues = yesterdayActivities
    .map((a) => a.anaerobicTE)
    .filter((v): v is number => typeof v === "number");
  const maxAnaerobicTE =
    anaerobicValues.length > 0 ? Math.max(...anaerobicValues) : null;

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
