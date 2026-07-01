import prisma from "../prisma";
import { todayKST, daysAgoKST, todayKSTString } from "../../lib/garmin/utils";
import { type Bucket, bucketOf, formatPace } from "./running-buckets";

type Confidence = "high" | "medium" | "low";

const RACE_DISTANCES: Record<Bucket, { name: string; meters: number }> = {
  "5k": { name: "5K", meters: 5000 },
  "10k": { name: "10K", meters: 10000 },
  HM: { name: "HM", meters: 21097.5 },
  FM: { name: "FM", meters: 42195 },
};

// Riegel fatigue factor (표준 1.06). 5K → 10K 예측 시 사용.
const RIEGEL_EXPONENT = 1.06;

interface RunRow {
  startTime: Date;
  distance: number;
  avgPace: number;
}

interface BucketSummary {
  count: number;
  best: RunRow;
  latest: RunRow;
  baseline: RunRow;
}

interface Prediction {
  timeSec: number;
  timeFormatted: string;
  paceFormatted: string;
  confidence: Confidence;
  basedOn: string;
}

function formatSecToTime(totalSec: number): string {
  const total = Math.round(totalSec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Riegel: T2 = T1 × (D2/D1)^1.06 (총 시간 초). 같은 거리면 T1 그대로. */
function riegelPredict(
  knownPaceSecPerKm: number,
  knownDistanceM: number,
  targetDistanceM: number
): number {
  const t1 = knownPaceSecPerKm * (knownDistanceM / 1000);
  return t1 * Math.pow(targetDistanceM / knownDistanceM, RIEGEL_EXPONENT);
}

function confidenceOf(count: number): Confidence | null {
  if (count >= 5) return "high";
  if (count >= 2) return "medium";
  if (count >= 1) return "low";
  return null;
}

/** source bucket 선택: 1) 자체 target bucket 우선 2) 다른 bucket 중 count 최대. */
function pickSource(
  target: Bucket,
  buckets: Map<Bucket, BucketSummary>
): { source: Bucket; summary: BucketSummary } | null {
  const self = buckets.get(target);
  if (self) return { source: target, summary: self };
  let best: { source: Bucket; summary: BucketSummary } | null = null;
  for (const [b, s] of buckets.entries()) {
    if (!best || s.count > best.summary.count) best = { source: b, summary: s };
  }
  return best;
}

function makePrediction(
  target: Bucket,
  run: RunRow,
  scenarioLabel: string,
  source: Bucket,
  count: number
): Prediction {
  const targetMeters = RACE_DISTANCES[target].meters;
  const timeSec = riegelPredict(run.avgPace, run.distance, targetMeters);
  const paceSec = timeSec / (targetMeters / 1000);
  const confidence = confidenceOf(count) ?? "low";
  const sameBucket = source === target;
  const basedOn = sameBucket
    ? `${target} ${scenarioLabel} (${(run.distance / 1000).toFixed(2)} km, ${formatPace(run.avgPace)} pace)`
    : `${source} ${scenarioLabel} via Riegel (${source}→${RACE_DISTANCES[target].name})`;
  return {
    timeSec: Math.round(timeSec),
    timeFormatted: formatSecToTime(timeSec),
    paceFormatted: formatPace(paceSec),
    confidence,
    basedOn,
  };
}

/**
 * 5K/10K/HM/FM race 예상 기록 (Riegel 공식, fatigue factor 1.06).
 * 각 target 3 시나리오: best/realistic/conservative (best/latest/baseline pace).
 * source bucket 우선순위: 자체 target > 다른 bucket 중 count 최대. 신뢰도 count 기반.
 */
export async function getRacePrediction(args: { windowDays?: number } = {}) {
  const windowDays = Math.min(365, Math.max(30, args.windowDays ?? 90));
  const since = daysAgoKST(windowDays - 1);
  const tomorrow = new Date(todayKST());
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const rows = await prisma.activity.findMany({
    where: {
      startTime: { gte: since, lt: tomorrow },
      activityType: { contains: "running" },
      distance: { not: null },
      avgPace: { not: null },
    },
    select: { startTime: true, distance: true, avgPace: true },
    orderBy: { startTime: "asc" },
  });

  const runs: RunRow[] = rows
    .filter(
      (r): r is { startTime: Date; distance: number; avgPace: number } =>
        r.distance !== null && r.avgPace !== null
    )
    .map((r) => ({ startTime: r.startTime, distance: r.distance, avgPace: r.avgPace }));

  // bucket 별 그룹핑 (asc 순서 유지 → baseline = [0], latest = last, best = min pace)
  const grouped = new Map<Bucket, RunRow[]>();
  for (const r of runs) {
    const b = bucketOf(r.distance);
    if (b === null) continue;
    const list = grouped.get(b);
    if (list) list.push(r);
    else grouped.set(b, [r]);
  }

  const buckets = new Map<Bucket, BucketSummary>();
  for (const [b, list] of grouped.entries()) {
    const best = list.reduce((a, c) => (a.avgPace < c.avgPace ? a : c));
    buckets.set(b, {
      count: list.length,
      baseline: list[0],
      latest: list[list.length - 1],
      best,
    });
  }

  const predictions: Partial<
    Record<Bucket, { best: Prediction | null; realistic: Prediction | null; conservative: Prediction | null }>
  > = {};
  for (const target of Object.keys(RACE_DISTANCES) as Bucket[]) {
    const picked = pickSource(target, buckets);
    if (!picked) {
      predictions[target] = { best: null, realistic: null, conservative: null };
      continue;
    }
    const { source, summary } = picked;
    predictions[target] = {
      best: makePrediction(target, summary.best, "best", source, summary.count),
      realistic: makePrediction(target, summary.latest, "latest", source, summary.count),
      conservative: makePrediction(
        target,
        summary.baseline,
        "baseline",
        source,
        summary.count
      ),
    };
  }

  const sourceData: Partial<
    Record<Bucket, { count: number; bestPaceFormatted?: string; latestPaceFormatted?: string }>
  > = {};
  for (const target of Object.keys(RACE_DISTANCES) as Bucket[]) {
    const s = buckets.get(target);
    if (!s) {
      sourceData[target] = { count: 0 };
    } else {
      sourceData[target] = {
        count: s.count,
        bestPaceFormatted: formatPace(s.best.avgPace),
        latestPaceFormatted: formatPace(s.latest.avgPace),
      };
    }
  }

  const payload = {
    date: todayKSTString(),
    windowDays,
    predictions,
    sourceData,
  };

  // 응답 토큰 절약을 위해 compact JSON (스펙 ≤ 600 토큰 준수).
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}
