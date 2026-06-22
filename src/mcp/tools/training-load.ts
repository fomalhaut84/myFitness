import prisma from "../prisma";
import {
  todayKST,
  daysAgoKST,
  todayKSTString,
  ymdKST,
} from "../../lib/garmin/utils";

type Zone = "detraining" | "sweet_spot" | "high" | "very_high" | "insufficient_data";

interface ZoneInfo {
  zone: Zone;
  recommendation: string;
}

function classifyACWR(acwr: number | null): ZoneInfo {
  if (acwr === null) {
    return {
      zone: "insufficient_data",
      recommendation: "28일 데이터 부족 — 추세 평가 불가",
    };
  }
  if (acwr < 0.8) {
    return {
      zone: "detraining",
      recommendation: "운동량 부족 — 피트니스 손실 위험, 점진적 증가 권장",
    };
  }
  if (acwr < 1.3) {
    return {
      zone: "sweet_spot",
      recommendation: "최적 부하 구간 — 현재 강도 유지",
    };
  }
  if (acwr < 1.5) {
    return {
      zone: "high",
      recommendation: "부하 증가 주의 — 회복일 추가 권장",
    };
  }
  return {
    zone: "very_high",
    recommendation: "부상 위험 — 회복 우선, 강도/시간 감소 권장",
  };
}

function round(n: number, digits = 1): number {
  const factor = Math.pow(10, digits);
  return Math.round(n * factor) / factor;
}

/** N일 윈도우 집계 (오늘 포함). dailyMap에서 최근 N일의 합계 + 휴식일 카운트. */
function aggregate(
  dailyMap: Map<string, number>,
  windowDays: number,
  todayStr: string
): { totalIntensityScore: number; avgDailyScore: number; days: number; restDays: number } {
  let total = 0;
  let restDays = 0;
  const today = new Date(`${todayStr}T00:00:00+09:00`);
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = ymdKST(d);
    const score = dailyMap.get(key) ?? 0;
    total += score;
    if (score === 0) restDays++;
  }
  return {
    totalIntensityScore: Math.round(total),
    avgDailyScore: round(total / windowDays, 1),
    days: windowDays,
    restDays,
  };
}

/**
 * 트레이닝 로드 추세 (ACWR 기반).
 * - Acute (7d) / Chronic (28d) / 보조 14d 윈도우의 일평균 부하
 * - ACWR = Acute avg / Chronic avg
 * - 위험 구간: detraining / sweet_spot / high / very_high
 */
export async function getTrainingLoadTrend() {
  // chronic 28d가 acute/14d의 상위 집합이므로 한 쿼리로 끝.
  // daysAgoKST(27)은 오늘 포함 28일의 가장 오래된 날짜.
  const start = daysAgoKST(27);
  const todayInstant = todayKST();
  // 끝 boundary는 오늘+1일 (오늘 활동 포함)
  const end = new Date(todayInstant);
  end.setUTCDate(end.getUTCDate() + 1);

  const activities = await prisma.activity.findMany({
    where: {
      startTime: { gte: start, lt: end },
      intensityScore: { not: null },
    },
    select: { startTime: true, intensityScore: true },
  });

  // 일자별 합계 (KST 날짜 기준)
  const dailyMap = new Map<string, number>();
  for (const a of activities) {
    if (a.intensityScore === null) continue;
    const dayKey = ymdKST(a.startTime);
    dailyMap.set(dayKey, (dailyMap.get(dayKey) ?? 0) + a.intensityScore);
  }

  const todayStr = todayKSTString();
  const acute7d = aggregate(dailyMap, 7, todayStr);
  const chronic28d = aggregate(dailyMap, 28, todayStr);
  const recent14d = aggregate(dailyMap, 14, todayStr);

  const acwr =
    chronic28d.avgDailyScore > 0
      ? round(acute7d.avgDailyScore / chronic28d.avgDailyScore, 2)
      : null;

  const { zone, recommendation } = classifyACWR(acwr);

  const payload = {
    date: todayStr,
    acute7d,
    chronic28d,
    recent14d,
    acwr,
    zone,
    recommendation,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}
