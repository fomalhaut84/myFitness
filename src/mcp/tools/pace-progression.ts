import prisma from "../prisma";
import { todayKST, daysAgoKST, todayKSTString, ymdKST } from "../../lib/garmin/utils";

type Bucket = "5k" | "10k" | "HM" | "FM";

const RUNNING_TYPES = ["running", "treadmill_running", "trail_running"];

interface RunRow {
  startTime: Date;
  distance: number;
  avgPace: number;
}

interface PacePoint {
  date: string;
  paceSecPerKm: number;
  paceFormatted: string;
}

interface BucketSummary {
  count: number;
  baseline: PacePoint;
  latest: PacePoint;
  best: PacePoint;
  improvementPct: number;
}

function round(n: number, digits = 1): number {
  const factor = Math.pow(10, digits);
  return Math.round(n * factor) / factor;
}

function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function bucketOf(distanceM: number): Bucket | null {
  const km = distanceM / 1000;
  if (km >= 4.5 && km < 5.5) return "5k";
  if (km >= 9.0 && km < 11.0) return "10k";
  if (km >= 20.0 && km < 22.0) return "HM";
  if (km >= 40.0 && km < 44.0) return "FM";
  return null;
}

function toPacePoint(r: RunRow): PacePoint {
  return {
    date: ymdKST(r.startTime),
    paceSecPerKm: Math.round(r.avgPace),
    paceFormatted: formatPace(r.avgPace),
  };
}

function summarizeBucket(runs: RunRow[]): BucketSummary {
  // 호출자는 runs를 startTime asc로 정렬해서 전달.
  const baseline = runs[0];
  const latest = runs[runs.length - 1];
  const best = runs.reduce((a, b) => (a.avgPace < b.avgPace ? a : b));
  const improvementPct =
    baseline.avgPace > 0
      ? round(((baseline.avgPace - latest.avgPace) / baseline.avgPace) * 100, 1)
      : 0;
  return {
    count: runs.length,
    baseline: toPacePoint(baseline),
    latest: toPacePoint(latest),
    best: toPacePoint(best),
    improvementPct,
  };
}

/**
 * 동일 거리 bucket 페이스 추세.
 * - 5k / 10k / HM / FM bucket 각각 baseline / latest / best + improvement %
 * - 보조: recentRuns 최근 5건
 */
export async function getPaceProgression(args: { windowDays?: number } = {}) {
  const windowDays = Math.min(365, Math.max(30, args.windowDays ?? 90));
  const since = daysAgoKST(windowDays - 1);
  const tomorrow = new Date(todayKST());
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const rows = await prisma.activity.findMany({
    where: {
      startTime: { gte: since, lt: tomorrow },
      activityType: { in: RUNNING_TYPES },
      distance: { not: null },
      avgPace: { not: null },
    },
    select: { startTime: true, distance: true, avgPace: true, activityType: true },
    orderBy: { startTime: "asc" },
  });

  const runs: RunRow[] = rows
    .filter(
      (r): r is { startTime: Date; distance: number; avgPace: number; activityType: string } =>
        r.distance !== null && r.avgPace !== null
    )
    .map((r) => ({ startTime: r.startTime, distance: r.distance, avgPace: r.avgPace }));

  const grouped = new Map<Bucket, RunRow[]>();
  for (const r of runs) {
    const b = bucketOf(r.distance);
    if (b === null) continue;
    const list = grouped.get(b);
    if (list) list.push(r);
    else grouped.set(b, [r]);
  }

  const buckets: Partial<Record<Bucket, BucketSummary>> = {};
  for (const [b, list] of grouped.entries()) {
    buckets[b] = summarizeBucket(list);
  }

  // 최근 5건 (asc 순서이므로 뒤 5개)
  const recentRuns = runs.slice(-5).reverse().map((r) => ({
    date: ymdKST(r.startTime),
    distanceKm: round(r.distance / 1000, 2),
    paceSecPerKm: Math.round(r.avgPace),
    paceFormatted: formatPace(r.avgPace),
    bucket: bucketOf(r.distance),
  }));

  const payload = {
    date: todayKSTString(),
    windowDays,
    buckets,
    recentRuns,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}
