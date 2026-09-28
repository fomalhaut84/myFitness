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
import { selectComparisons } from "./comparison-pick";
import { extractRawExtras } from "./raw-extras";
import { toEvalLaps, type EvalLap } from "./splits";
import type { BucketBest, ComparisonRun, EvalActivity, EvalInput, HrrBaseline } from "./types";

/** 같은 코스 · 비슷한 거리 각각의 표시 상한 */
const SAME_COURSE_LIMIT = 10;
/** 같은 코스 스캔 상한 — 표시는 10건이지만 비슷한 거리의 제외 집합은 **이전 같은 코스 전부** 여야 한다 (#448). 매처 내부 스캔 상한과 같은 크기 */
const SAME_COURSE_SCAN = 500;
const SIMILAR_LIMIT = 10;
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

/**
 * 비슷한 거리 조회 조건 — 순수 (회귀 테스트 대상). ±10% · 활동 시작일 기준 직전 365일 · 자신과 **같은 코스 전부** 를 DB 에서 제외.
 * 릴리즈 PR #464 Codex P2: 후보 상한을 먼저 걸고 같은 코스를 나중에 빼면, 최근 20건이 전부 같은 코스일 때 목록이 빈다 → 제외를 쿼리 안으로.
 */
export function similarDistanceWhere(row: { id: string; startTime: Date; distance: number }, excludeIds: readonly string[]) {
  return {
    AND: [
      RUNNING_ACTIVITY_WHERE,
      {
        id: { notIn: [row.id, ...excludeIds] },
        startTime: { gte: new Date(row.startTime.getTime() - SIMILAR_WINDOW_DAYS * DAY_MS), lt: row.startTime },
        distance: { gte: row.distance * (1 - SIMILAR_DISTANCE_TOLERANCE), lte: row.distance * (1 + SIMILAR_DISTANCE_TOLERANCE) },
      },
    ],
  };
}

/** 비슷한 거리 · 최근순 · 상한. 같은 코스는 쿼리에서 이미 빠져 있으므로 상한이 다른 코스로 채워진다 */
async function loadSimilarDistance(row: ActivityRow, excludeIds: readonly string[]): Promise<ComparisonRun[]> {
  if (row.distance === null || row.distance <= 0) return [];
  const rows = await prisma.activity.findMany({
    where: similarDistanceWhere({ id: row.id, startTime: row.startTime, distance: row.distance }, excludeIds),
    orderBy: { startTime: "desc" },
    take: SIMILAR_LIMIT,
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
  // #448: 평가 기준선은 **이전** 기록만 — 매처가 DB 에서 before 로 자르므로 이후 기록이 상한을 차지하지 않는다 (비슷한 거리와 같은 방향).
  // 릴리즈 PR #464 Codex P2: 비슷한 거리는 같은 코스 id 를 쿼리에서 빼야 하므로 같은 코스 promise 에만 체인한다 —
  // PR #465 Codex P2: 전체 Promise.all 뒤에 두면 느린 Garmin 스플릿 조회 (loadLaps) 를 기다린 뒤에야 시작한다
  const sameCoursePromise = findSimilarActivities(id, { limit: SAME_COURSE_SCAN, before: row.startTime });
  const [recovery, sameRaw, similarRaw, hrrBaseline, bucketBest, laps] = await Promise.all([
    loadActivityRecovery(id),
    sameCoursePromise,
    sameCoursePromise.then((same) => loadSimilarDistance(row, same.map((r) => r.id))),
    loadHrrBaseline(row),
    loadBucketBest(row),
    loadLaps(row),
  ]);
  // 쿼리에서 이미 뺐지만 순수 선별을 그대로 둔다 (표시 상한 · 안전망)
  const picked = selectComparisons(sameRaw.map(toComparisonRun), similarRaw, { sameCourse: SAME_COURSE_LIMIT, similarDistance: SIMILAR_LIMIT });
  return { ...base, recovery, laps, ...picked, hrrBaseline, bucketBest };
}
