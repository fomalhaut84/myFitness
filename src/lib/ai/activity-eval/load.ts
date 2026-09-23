// #440: 활동 AI 평가 입력 로딩 — 서버 전용 (prisma · Garmin). 활동 rawData 는 여기서만 읽고 `extractRawExtras` 결과만 DTO 에 싣는다.
// 조립 (`buildEvalContext`) 은 순수 — 이 파일은 조회만 한다.
import prisma from "@/lib/prisma";
import { RUNNING_ACTIVITY_WHERE, isRunningType } from "@/lib/activity/running-types";
import { findSimilarActivities } from "@/lib/activity/similar-activities";
import { parseZoneDistribution } from "@/lib/fitness/intensity";
import { fetchActivitySplits } from "@/lib/garmin/activity-splits";
import { ymdKST } from "@/lib/garmin/utils";
import { loadActivityRecovery } from "@/lib/heart/load-recovery";
import { kstDayRange } from "@/lib/history/buckets";
import { MIN_YEAR_RUNS } from "@/lib/insights/recovery";
import { median } from "@/lib/insights/stats";
import { BUCKET_RANGES_M, bucketOf } from "@/lib/running/buckets";
import { extractRawExtras } from "./raw-extras";
import { toEvalLaps, type EvalLap } from "./splits";
import type { BucketBest, ComparisonRun, EvalActivity, EvalInput, HrrBaseline } from "./types";

/** 같은 코스 · 비슷한 거리 각각의 상한 */
const SAME_COURSE_LIMIT = 10;
/** 같은 코스 후보 — `findSimilarActivities` 는 활동 앞뒤를 보므로 이전 기록만 남긴 뒤에도 상한을 채우도록 넉넉히 (PR #446 Codex P2) */
const SAME_COURSE_CANDIDATES = SAME_COURSE_LIMIT * 3;
const SIMILAR_LIMIT = 10;
/** 비슷한 거리 후보 — 같은 코스와 겹치는 것을 뺀 뒤에도 상한을 채우도록 넉넉히 */
const SIMILAR_CANDIDATES = SIMILAR_LIMIT * 2;
const SIMILAR_WINDOW_DAYS = 365;
const SIMILAR_DISTANCE_TOLERANCE = 0.1;
const DAY_MS = 86_400_000;

const ACTIVITY_SELECT = {
  id: true,
  garminId: true,
  name: true,
  activityType: true,
  startTime: true,
  duration: true,
  distance: true,
  calories: true,
  avgHR: true,
  maxHR: true,
  avgPace: true,
  elevationGain: true,
  avgCadence: true,
  avgStrideLength: true,
  avgVerticalOscillation: true,
  avgGroundContactTime: true,
  aerobicTE: true,
  anaerobicTE: true,
  avgRespirationRate: true,
  lapCount: true,
  vo2maxEstimate: true,
  zoneDistribution: true,
  estimatedZone: true,
  intensityScore: true,
  intensityLabel: true,
  routeTag: true,
  wristTempMaxC: true,
  wristTempMinC: true,
  weatherTempC: true,
  weatherApparentTempC: true,
  weatherHumidityPct: true,
  weatherWindMs: true,
  weatherPrecipMm: true,
  weatherCode: true,
  hrr2: true,
  hrrDrop10: true,
  rawData: true,
} as const;

const COMPARISON_SELECT = {
  id: true,
  startTime: true,
  name: true,
  distance: true,
  avgPace: true,
  avgHR: true,
  avgCadence: true,
  hrr2: true,
  intensityLabel: true,
  routeTag: true,
} as const;

type ActivityRow = NonNullable<Awaited<ReturnType<typeof findActivity>>>;

function findActivity(id: string) {
  return prisma.activity.findUnique({ where: { id }, select: ACTIVITY_SELECT });
}

function toEvalActivity(row: ActivityRow): EvalActivity {
  return {
    id: row.id,
    name: row.name,
    activityType: row.activityType,
    startIso: row.startTime.toISOString(),
    ymd: ymdKST(row.startTime),
    durationSec: row.duration,
    distanceM: row.distance,
    calories: row.calories,
    avgHR: row.avgHR,
    maxHR: row.maxHR,
    avgPace: row.avgPace,
    elevationGainM: row.elevationGain,
    avgCadence: row.avgCadence,
    avgStrideLengthM: row.avgStrideLength,
    avgVerticalOscillationCm: row.avgVerticalOscillation,
    avgGroundContactTimeMs: row.avgGroundContactTime,
    aerobicTE: row.aerobicTE,
    anaerobicTE: row.anaerobicTE,
    avgRespirationRate: row.avgRespirationRate,
    lapCount: row.lapCount,
    vo2maxEstimate: row.vo2maxEstimate,
    zoneDistribution: parseZoneDistribution(row.zoneDistribution),
    estimatedZone: row.estimatedZone,
    intensityScore: row.intensityScore,
    intensityLabel: row.intensityLabel,
    routeTag: row.routeTag,
    wristTempMaxC: row.wristTempMaxC,
    wristTempMinC: row.wristTempMinC,
    weatherTempC: row.weatherTempC,
    weatherApparentTempC: row.weatherApparentTempC,
    weatherHumidityPct: row.weatherHumidityPct,
    weatherWindMs: row.weatherWindMs,
    weatherPrecipMm: row.weatherPrecipMm,
    weatherCode: row.weatherCode,
    hrr2: row.hrr2,
    hrrDrop10: row.hrrDrop10,
  };
}

function toComparisonRun(r: {
  id: string;
  startTime: Date;
  name: string;
  distance: number | null;
  avgPace: number | null;
  avgHR: number | null;
  avgCadence?: number | null;
  hrr2?: number | null;
  intensityLabel: string | null;
  routeTag: string | null;
}): ComparisonRun {
  return {
    id: r.id,
    ymd: ymdKST(r.startTime),
    name: r.name,
    distanceM: r.distance,
    avgPace: r.avgPace,
    avgHR: r.avgHR,
    avgCadence: r.avgCadence ?? null,
    hrr2: r.hrr2 ?? null,
    intensityLabel: r.intensityLabel,
    routeTag: r.routeTag,
  };
}

/** 비슷한 거리 (±10%) · 활동 시작일 기준 직전 365일 · 최근순. 같은 코스와 겹치는 id 는 호출자가 뺀다 */
async function loadSimilarDistance(row: ActivityRow): Promise<ComparisonRun[]> {
  if (row.distance === null || row.distance <= 0) return [];
  const rows = await prisma.activity.findMany({
    where: {
      AND: [
        RUNNING_ACTIVITY_WHERE,
        {
          id: { not: row.id },
          startTime: { gte: new Date(row.startTime.getTime() - SIMILAR_WINDOW_DAYS * DAY_MS), lt: row.startTime },
          distance: { gte: row.distance * (1 - SIMILAR_DISTANCE_TOLERANCE), lte: row.distance * (1 + SIMILAR_DISTANCE_TOLERANCE) },
        },
      ],
    },
    orderBy: { startTime: "desc" },
    take: SIMILAR_CANDIDATES,
    select: COMPARISON_SELECT,
  });
  return rows.map(toComparisonRun);
}

/** 같은 해 (KST) 러닝의 2분 HRR 중앙값 — 패널 E 와 같은 5건 규칙 */
async function loadHrrBaseline(row: ActivityRow): Promise<HrrBaseline | null> {
  const year = Number(ymdKST(row.startTime).slice(0, 4));
  const rows = await prisma.activity.findMany({
    where: {
      AND: [RUNNING_ACTIVITY_WHERE, { hrr2: { not: null }, startTime: { gte: kstDayRange(`${year}-01-01`).start, lt: kstDayRange(`${year}-12-31`).end } }],
    },
    select: { hrr2: true },
  });
  const values = rows.flatMap((r) => (r.hrr2 === null ? [] : [r.hrr2]));
  const m = values.length >= MIN_YEAR_RUNS ? median(values) : null;
  return m === null ? null : { year, median: Math.round(m), n: values.length };
}

/** 거리 버킷 전 기간 최저 페이스 1건 (이 활동 자신 포함 — 자신이면 빌더가 "개인 최고" 라고 말한다). 동률이면 먼저 달성한 날 */
async function loadBucketBest(row: ActivityRow): Promise<BucketBest | null> {
  const bucket = row.distance !== null ? bucketOf(row.distance) : null;
  if (bucket === null) return null;
  const range = BUCKET_RANGES_M[bucket];
  const best = await prisma.activity.findFirst({
    where: { AND: [RUNNING_ACTIVITY_WHERE, { distance: { gte: range.min, lt: range.max }, avgPace: { gt: 0 } }] },
    orderBy: [{ avgPace: "asc" }, { startTime: "asc" }],
    select: { id: true, startTime: true, avgPace: true },
  });
  if (!best || best.avgPace === null) return null;
  return { bucket, activityId: best.id, ymd: ymdKST(best.startTime), avgPace: best.avgPace };
}

/** Garmin 스플릿 — 실패는 null (평가는 계속 · 섹션은 `omitted`). 원인은 서버 로그에만 */
async function loadLaps(row: ActivityRow): Promise<EvalLap[] | null> {
  try {
    return toEvalLaps(await fetchActivitySplits(row.garminId));
  } catch (error) {
    console.warn(`[activity-eval] splits fetch failed activity=${row.id}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/** 활동 없음 → null. 러닝 계열만 회복 · 비교 · 스플릿을 읽고, 그 외는 기본 지표 (요약 모드) 만 */
export async function loadActivityEvalInput(id: string): Promise<EvalInput | null> {
  const row = await findActivity(id);
  if (!row) return null;
  const base = { activity: toEvalActivity(row), extras: extractRawExtras(row.rawData) };
  if (!isRunningType(row.activityType)) {
    return { ...base, recovery: null, laps: null, sameCourse: [], similarDistance: [], hrrBaseline: null, bucketBest: null };
  }
  const [recovery, sameRaw, similarRaw, hrrBaseline, bucketBest, laps] = await Promise.all([
    loadActivityRecovery(id),
    findSimilarActivities(id, { limit: SAME_COURSE_CANDIDATES }),
    loadSimilarDistance(row),
    loadHrrBaseline(row),
    loadBucketBest(row),
    loadLaps(row),
  ]);
  // 사전 리뷰 info 1: `findSimilarActivities` 는 활동 앞뒤 2년 (태그는 기간 없음) 을 본다 — 평가 기준선은 **이전** 기록만 (비슷한 거리와 같은 방향).
  // PR #446 Codex P2: 상한을 먼저 걸면 이후 기록 10건이 이전 기록을 밀어낸다 → 후보를 넉넉히 받아 거른 뒤 상한
  const sameCourse = sameRaw
    .filter((a) => a.startTime.getTime() < row.startTime.getTime())
    .slice(0, SAME_COURSE_LIMIT)
    .map(toComparisonRun);
  const sameIds = new Set(sameCourse.map((r) => r.id));
  const similarDistance = similarRaw.filter((r) => !sameIds.has(r.id)).slice(0, SIMILAR_LIMIT);
  return { ...base, recovery, laps, sameCourse, similarDistance, hrrBaseline, bucketBest };
}
