import prisma from "../prisma";
import { todayKST, daysAgoKST, todayKSTString, ymdKST } from "../../lib/garmin/utils";

type FactorName =
  | "hrv_decline"
  | "acwr_load"
  | "sleep_instability"
  | "resting_hr_rise";

interface FactorResult {
  score: number | null;
  detail: string;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
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

/** HRV 하락 — 최근 7일 평균 vs 8-14일 전 평균. 하락폭 클수록 위험. */
function computeHrvDecline(
  sleeps: { date: Date; hrvOvernight: number | null }[]
): FactorResult {
  const today = todayKSTString();
  const sevenAgo = ymdKST(daysAgoKST(7));
  // last7: date >= 7일 전 ~ < 오늘
  const last7 = sleeps.filter((s) => {
    const d = ymdKST(s.date);
    return d >= sevenAgo && d < today;
  });
  // prev7: 8-14일 전
  const fourteenAgo = ymdKST(daysAgoKST(14));
  const prev7 = sleeps.filter((s) => {
    const d = ymdKST(s.date);
    return d >= fourteenAgo && d < sevenAgo;
  });
  const recentAvg = average(last7.map((s) => s.hrvOvernight));
  const prevAvg = average(prev7.map((s) => s.hrvOvernight));
  if (recentAvg === null || prevAvg === null || prevAvg === 0) {
    return { score: null, detail: "HRV 데이터 부족 (최근 7일 또는 이전 7일)" };
  }
  const dropPct = ((prevAvg - recentAvg) / prevAvg) * 100;
  // 하락 0% = 0점, 10% = 50점, 20%+ = 100점
  const score = Math.round(clamp(dropPct * 5, 0, 100));
  const arrow = dropPct >= 0 ? "↓" : "↑";
  return {
    score,
    detail: `최근 7일 HRV 평균 ${round(recentAvg, 1)} ms vs 이전 7일 평균 ${round(
      prevAvg,
      1
    )} ms (${arrow}${Math.abs(Math.round(dropPct * 10) / 10)}%)`,
  };
}

/** ACWR 위험 — Activity intensityScore 기반. high/very_high zone 시 점수 ↑.
 * M5-2-2 (training-load.ts) 와 동일 윈도우: acute [t-6..t] (오늘 포함 7일), chronic [t-27..t] (오늘 포함 28일).
 * 같은 입력에 두 도구가 다른 ACWR 산출하면 AI 가 혼동하므로 일치 필수. */
function computeAcwrLoad(
  activities: { startTime: Date; intensityScore: number | null }[]
): FactorResult {
  const today = todayKSTString();
  const sevenAgo = ymdKST(daysAgoKST(6));
  const twentyEightAgo = ymdKST(daysAgoKST(27));
  let acuteTotal = 0;
  let chronicTotal = 0;
  for (const a of activities) {
    if (a.intensityScore === null) continue;
    const d = ymdKST(a.startTime);
    if (d >= twentyEightAgo && d <= today) {
      chronicTotal += a.intensityScore;
      if (d >= sevenAgo) acuteTotal += a.intensityScore;
    }
  }
  const acuteAvg = acuteTotal / 7;
  const chronicAvg = chronicTotal / 28;
  if (chronicAvg <= 0) {
    return {
      score: null,
      detail: "28일 chronic load 0 — ACWR 산출 불가",
    };
  }
  const acwr = acuteAvg / chronicAvg;
  // < 0.8: detraining → 50점 (피트니스 손실 위험)
  // 0.8 ~ 1.3: sweet spot → 0-20점
  // 1.3 ~ 1.5: high → 50-75점
  // > 1.5: very_high → 80-100점
  let score: number;
  if (acwr < 0.8) score = 50;
  else if (acwr < 1.3) score = Math.round(clamp((acwr - 0.8) * 40, 0, 20));
  else if (acwr <= 1.5) score = Math.round(clamp(50 + (acwr - 1.3) * 125, 50, 75));
  else score = Math.round(clamp(80 + (acwr - 1.5) * 40, 80, 100));
  return {
    score,
    detail: `ACWR ${round(acwr, 2)} (acute 7d avg ${round(acuteAvg, 1)} / chronic 28d avg ${round(
      chronicAvg,
      1
    )})`,
  };
}

/** 수면 불안정 — 14일 sleepScore의 coefficient of variation. */
function computeSleepInstability(
  sleeps: { sleepScore: number | null }[]
): FactorResult {
  const scores = sleeps
    .map((s) => s.sleepScore)
    .filter((v): v is number => typeof v === "number");
  if (scores.length < 7) {
    return {
      score: null,
      detail: `수면 점수 데이터 부족 (${scores.length}/7일 최소)`,
    };
  }
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (mean === 0) {
    return { score: null, detail: "수면 점수 평균 0 — 분포 산출 불가" };
  }
  const variance =
    scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  const cv = (stdDev / mean) * 100;
  // CV 0-5%: 안정 (0점), 5-15%: 보통/불안정 점진, 15%+: 100점
  const score = Math.round(clamp((cv - 5) * 10, 0, 100));
  return {
    score,
    detail: `최근 14일 수면 점수 평균 ${round(mean, 1)} ± ${round(
      stdDev,
      1
    )} (CV ${round(cv, 1)}%)`,
  };
}

/** RestingHR 상승 — 최근 7일 평균 vs 28일 baseline. */
function computeRestingHrRise(
  sleeps14d: { date: Date; restingHR: number | null }[],
  dailies28d: { restingHR: number | null }[]
): FactorResult {
  const today = todayKSTString();
  const sevenAgo = ymdKST(daysAgoKST(7));
  const last7Sleeps = sleeps14d.filter((s) => {
    const d = ymdKST(s.date);
    return d >= sevenAgo && d < today;
  });
  const recentAvg = average(last7Sleeps.map((s) => s.restingHR));
  const baselineAvg = average(dailies28d.map((d) => d.restingHR));
  if (recentAvg === null || baselineAvg === null) {
    return {
      score: null,
      detail: "RestingHR 데이터 부족 (최근 7일 또는 28일 baseline)",
    };
  }
  const deltaBpm = recentAvg - baselineAvg;
  // 0 bpm = 0점, +3 bpm = 50점, +6 bpm 이상 = 100점
  const score = Math.round(clamp(deltaBpm * 16.7, 0, 100));
  const arrow = deltaBpm >= 0 ? "↑" : "↓";
  return {
    score,
    detail: `최근 7일 RHR 평균 ${Math.round(recentAvg)} bpm vs 28일 baseline ${Math.round(
      baselineAvg
    )} bpm (${arrow}${Math.abs(Math.round(deltaBpm))} bpm)`,
  };
}

function classify(score: number): { label: string; recommendation: string } {
  if (score < 25) return { label: "safe", recommendation: "현재 패턴 유지" };
  if (score < 50)
    return { label: "caution", recommendation: "회복일 1회 추가 권장" };
  if (score < 75)
    return { label: "elevated", recommendation: "이번 주 강도 -20%, 회복 우선" };
  return { label: "high", recommendation: "2-3일 완전 휴식 권장" };
}

/**
 * 부상/오버트레이닝 위험 점수 (0-100) + 4단계 라벨 + 기여 요인 top 3 + 권장 조치.
 * 4개 요인 각 25% 가중치: HRV 하락 / ACWR / 수면 불안정 / RHR 상승.
 * 데이터 누락 요인은 가중치에서 제외 (재정규화).
 */
export async function getInjuryRiskScore() {
  const today = todayKST();
  const fourteenDaysAgo = daysAgoKST(14);
  const twentyEightDaysAgo = daysAgoKST(28);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const [sleeps14d, dailies28d, activities28d] = await Promise.all([
    prisma.sleepRecord.findMany({
      where: { date: { gte: fourteenDaysAgo, lt: today } },
      select: { date: true, hrvOvernight: true, restingHR: true, sleepScore: true },
    }),
    prisma.dailySummary.findMany({
      where: { date: { gte: twentyEightDaysAgo, lt: today } },
      select: { restingHR: true },
    }),
    prisma.activity.findMany({
      where: { startTime: { gte: twentyEightDaysAgo, lt: tomorrow } },
      select: { startTime: true, intensityScore: true },
    }),
  ]);

  const factors: Record<FactorName, FactorResult> = {
    hrv_decline: computeHrvDecline(sleeps14d),
    acwr_load: computeAcwrLoad(activities28d),
    sleep_instability: computeSleepInstability(sleeps14d),
    resting_hr_rise: computeRestingHrRise(sleeps14d, dailies28d),
  };

  const weights: Record<FactorName, number> = {
    hrv_decline: 25,
    acwr_load: 25,
    sleep_instability: 25,
    resting_hr_rise: 25,
  };

  // 유효 요인 (null 제외) 가중 평균 + 재정규화
  const validEntries = (Object.entries(factors) as [FactorName, FactorResult][])
    .filter(([, f]) => f.score !== null);
  let riskScore: number | null = null;
  let classification: { label: string; recommendation: string } | null = null;
  if (validEntries.length > 0) {
    const totalWeight = validEntries.reduce((a, [n]) => a + weights[n], 0);
    const weighted = validEntries.reduce(
      (a, [n, f]) => a + (f.score as number) * weights[n],
      0
    );
    riskScore = Math.round(weighted / totalWeight);
    classification = classify(riskScore);
  }

  // 기여 요인 top 3 (유효한 것만, score 내림차순)
  const topFactors = validEntries
    .map(([name, f]) => ({
      factor: name,
      score: f.score as number,
      detail: f.detail,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const payload = {
    date: todayKSTString(),
    riskScore,
    label: classification?.label ?? null,
    recommendation: classification?.recommendation ?? null,
    topFactors,
    allFactors: {
      hrv_decline: { score: factors.hrv_decline.score, detail: factors.hrv_decline.detail },
      acwr_load: { score: factors.acwr_load.score, detail: factors.acwr_load.detail },
      sleep_instability: {
        score: factors.sleep_instability.score,
        detail: factors.sleep_instability.detail,
      },
      resting_hr_rise: {
        score: factors.resting_hr_rise.score,
        detail: factors.resting_hr_rise.detail,
      },
    },
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}
