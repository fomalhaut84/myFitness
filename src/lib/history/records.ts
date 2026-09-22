/**
 * #396 (M15-4): 개인 기록 — 전 기간 러닝 최고 (거리 버킷별 최저 페이스) · 최장 거리 · 최다 km 월 · 최고 VO2max · 최저 안정시 심박 · 레이스 목록.
 *
 * MCP 의 `pace-progression` · `race-prediction` 은 **창(windowDays) 안** 최저 페이스라 여기서 전 기간 랭킹을 따로 둔다.
 * 랭킹은 순수 함수 (`rankRunningRecords` · `firstExtreme`) — 동률이면 **먼저 달성한 날** 이 기록이다.
 */
import prisma from "@/lib/prisma";
import { ymdKST } from "@/lib/garmin/utils";
import { RACE_EVENT_TYPE } from "@/lib/garmin/parse-event-type";
import { RUNNING_ACTIVITY_WHERE } from "@/lib/activity/running-types";
import { type Bucket, bucketOf } from "@/lib/running/buckets";
import { getHistorySummary, type HistorySummary, type SummaryBucket } from "./summary";
import type { SummaryParams } from "./summary-params";

export const RECORD_BUCKETS: readonly Bucket[] = ["5k", "10k", "HM", "FM"];
/** 버킷 하한 (5k 는 4.5km 부터) — 조회 범위를 좁히는 용도. `bucketOf` 가 정본. */
const MIN_BUCKET_DISTANCE_M = 4500;

export interface RunningRecordRow {
  id: string;
  ymd: string;
  name: string;
  distanceM: number;
  durationSec: number;
  avgPace: number;
  race: boolean;
}

/** 레이스 목록 행 — 러닝이 아닌 활동 (거리 0 · 페이스 없음) 도 레이스일 수 있어 거리 · 페이스는 옵셔널 (사전 리뷰 major 2) */
export interface RaceRow {
  id: string;
  ymd: string;
  name: string;
  distanceM: number | null;
  durationSec: number;
  avgPace: number | null;
}

export interface DatedValue {
  value: number;
  ymd: string;
}

export interface BestMonth {
  ym: string;
  km: number;
  count: number | null;
  /** 오늘이 속한 달 (아직 끝나지 않음) */
  current: boolean;
}

export interface PersonalRecords {
  byBucket: Record<Bucket, RunningRecordRow | null>;
  longest: RunningRecordRow | null;
  bestMonth: BestMonth | null;
  bestVo2max: DatedValue | null;
  lowestRestingHR: DatedValue | null;
  /** 최신순 · `eventType = "race"` 전부 */
  races: RaceRow[];
}

/** 동률이면 먼저 달성한 날 (ymd 오름차순). `direction` 은 `"min"` (페이스 · 심박) 또는 `"max"` (거리 · VO2max). */
export function firstExtreme<T>(rows: readonly T[], value: (row: T) => number, ymd: (row: T) => string, direction: "min" | "max"): T | null {
  return rows.reduce<T | null>((best, row) => {
    if (best === null) return row;
    const a = value(row);
    const b = value(best);
    if (a === b) return ymd(row) < ymd(best) ? row : best;
    return (direction === "min" ? a < b : a > b) ? row : best;
  }, null);
}

/** 거리 버킷별 최저 평균 페이스. 버킷 밖 거리 (예: 15km) 는 버킷 기록에 들어가지 않는다. 최장 거리는 별도 조회 (버킷 하한 밖 거리도 대상). */
export function rankRunningRecords(rows: readonly RunningRecordRow[]): Record<Bucket, RunningRecordRow | null> {
  return Object.fromEntries(
    RECORD_BUCKETS.map((bucket) => {
      const inBucket = rows.filter((r) => bucketOf(r.distanceM) === bucket);
      return [bucket, firstExtreme(inBucket, (r) => r.avgPace, (r) => r.ymd, "min")];
    }),
  ) as Record<Bucket, RunningRecordRow | null>;
}

/** 월 버킷 중 러닝 km 최대. 이번 달이 최다면 사실이다 — 제외하지 않고 `current` 로 표시한다. */
export function bestRunningMonth(buckets: readonly SummaryBucket[], today: string): BestMonth | null {
  const best = firstExtreme(
    buckets.filter((b) => (b.values.runningKm?.value ?? 0) > 0),
    (b) => b.values.runningKm?.value ?? 0,
    (b) => b.key,
    "max",
  );
  if (!best) return null;
  return {
    ym: best.key,
    km: best.values.runningKm?.value ?? 0,
    count: best.values.runningCount?.value ?? null,
    current: best.start <= today && today < best.end,
  };
}

export type ActivityRow = {
  id: string;
  startTime: Date;
  name: string;
  distance: number | null;
  duration: number;
  avgPace: number | null;
  eventType: string | null;
};

function toRunningRow(r: ActivityRow): RunningRecordRow | null {
  if (r.distance === null || r.avgPace === null || r.distance <= 0 || r.avgPace <= 0) return null;
  return {
    id: r.id,
    ymd: ymdKST(r.startTime),
    name: r.name,
    distanceM: r.distance,
    durationSec: r.duration,
    avgPace: r.avgPace,
    race: r.eventType === RACE_EVENT_TYPE,
  };
}

export function toRaceRow(r: ActivityRow): RaceRow {
  return {
    id: r.id,
    ymd: ymdKST(r.startTime),
    name: r.name,
    distanceM: r.distance !== null && r.distance > 0 ? r.distance : null,
    durationSec: r.duration,
    avgPace: r.avgPace !== null && r.avgPace > 0 ? r.avgPace : null,
  };
}

const ACTIVITY_SELECT = {
  id: true,
  startTime: true,
  name: true,
  distance: true,
  duration: true,
  avgPace: true,
  eventType: true,
} as const;


export type SummaryLoader = (params: SummaryParams, ctx: { lowerBound: string; today: string }) => Promise<HistorySummary>;

/** `loadSummary` 는 캐시 래퍼 (`cache.ts`) 가 주입한다 — records ↔ cache 순환 import 방지 (사전 리뷰 info 4). */
export async function getPersonalRecords(
  ctx: { lowerBound: string; today: string },
  loadSummary: SummaryLoader = getHistorySummary,
): Promise<PersonalRecords> {
  const [bucketRows, longestRow, raceRows, vo2, rhr, monthly] = await Promise.all([
    prisma.activity.findMany({
      where: { AND: [RUNNING_ACTIVITY_WHERE, { distance: { gte: MIN_BUCKET_DISTANCE_M }, avgPace: { not: null } }] },
      select: ACTIVITY_SELECT,
    }),
    prisma.activity.findFirst({
      where: { AND: [RUNNING_ACTIVITY_WHERE, { distance: { not: null }, avgPace: { not: null } }] },
      orderBy: [{ distance: "desc" }, { startTime: "asc" }],
      select: ACTIVITY_SELECT,
    }),
    prisma.activity.findMany({
      where: { eventType: RACE_EVENT_TYPE },
      orderBy: { startTime: "desc" },
      select: ACTIVITY_SELECT,
    }),
    prisma.fitnessMetricDaily.findFirst({
      where: { vo2maxRunning: { not: null } },
      orderBy: [{ vo2maxRunning: "desc" }, { date: "asc" }],
      select: { date: true, vo2maxRunning: true },
    }),
    // stub 행 (0) 방어 — 안정시 심박 0 은 측정이 아니다
    prisma.dailySummary.findFirst({
      where: { restingHR: { gt: 0 } },
      orderBy: [{ restingHR: "asc" }, { date: "asc" }],
      select: { date: true, restingHR: true },
    }),
    loadSummary(
      { granularity: "month", from: ctx.lowerBound, to: ctx.today, metrics: ["runningKm", "runningCount"], clampedFrom: false, clampedTo: false },
      ctx,
    ),
  ]);

  const rows = bucketRows.map(toRunningRow).filter((r): r is RunningRecordRow => r !== null);
  const byBucket = rankRunningRecords(rows);
  const longest = longestRow ? toRunningRow(longestRow) : null;
  return {
    byBucket,
    longest,
    bestMonth: bestRunningMonth(monthly.buckets, ctx.today),
    bestVo2max: vo2?.vo2maxRunning != null ? { value: vo2.vo2maxRunning, ymd: ymdKST(vo2.date) } : null,
    lowestRestingHR: rhr?.restingHR != null ? { value: rhr.restingHR, ymd: ymdKST(rhr.date) } : null,
    races: raceRows.map(toRaceRow),
  };
}
