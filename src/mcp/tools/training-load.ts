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
  if (acwr <= 1.5) {
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

interface WindowRaw {
  rawTotal: number;
  restDays: number;
}

interface WindowDisplay {
  totalIntensityScore: number;
  avgDailyScore: number;
  days: number;
  restDays: number;
}

/** N일 윈도우 raw 집계 (오늘 포함). round 적용 전 — ACWR 분류용. */
function aggregateRaw(
  dailyMap: Map<string, number>,
  windowDays: number,
  todayStr: string
): WindowRaw {
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
  return { rawTotal: total, restDays };
}

/** raw 집계 → 응답 표시용 round 형식. */
function toDisplay(raw: WindowRaw, windowDays: number): WindowDisplay {
  return {
    totalIntensityScore: Math.round(raw.rawTotal),
    avgDailyScore: round(raw.rawTotal / windowDays, 1),
    days: windowDays,
    restDays: raw.restDays,
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
  const acute7dRaw = aggregateRaw(dailyMap, 7, todayStr);
  const chronic28dRaw = aggregateRaw(dailyMap, 28, todayStr);
  const recent14dRaw = aggregateRaw(dailyMap, 14, todayStr);

  // 분류는 unrounded 합계로 직접 산출 — aggregate 내부 round나 display의 1자리 round로
  // 인한 경계 flip(예: raw 1.503 → display avg 사용 시 1.487로 분류) 차단.
  const acwrRaw =
    chronic28dRaw.rawTotal > 0
      ? (acute7dRaw.rawTotal / 7) / (chronic28dRaw.rawTotal / 28)
      : null;
  const acwr = acwrRaw !== null ? round(acwrRaw, 2) : null;

  const { zone, recommendation } = classifyACWR(acwrRaw);

  const acute7d = toDisplay(acute7dRaw, 7);
  const chronic28d = toDisplay(chronic28dRaw, 28);
  const recent14d = toDisplay(recent14dRaw, 14);

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
