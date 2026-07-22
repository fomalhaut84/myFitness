// #261: 같은 코스에서 뛴 활동 비교. 두 축으로 매칭:
//   (a) GPS 시작점 반경 + 거리 유사 (auto-cluster)
//   (b) routeTag 동일 (사용자 커스텀 태그)
//
// 매칭 조건은 (a) OR (b). 사용자가 태그 부여 시 GPS 다른 활동도 강제 그룹 가능.
// 단일 사용자 데이터셋 (~수백 records) 이라 PostGIS 없이 in-memory Haversine 계산.

import type { Activity } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";

const DEFAULT_RADIUS_METERS = 150; // 같은 시작점으로 볼 반경
const DEFAULT_DISTANCE_TOLERANCE = 0.1; // 거리 ±10% 이내 = 같은 코스
const DEFAULT_LIMIT = 10;
const EARTH_RADIUS_M = 6371_000;
// 후보 스캔 상한. 단일 사용자 (수백~수천 records) 라 500 정도면 사실상 모든 러닝 커버.
const CANDIDATE_SCAN_CAP = 500;
// 대상 활동 기준 앞뒤 2년 = 4년 창. 계절/연도 대비 목적. Codex P1 #1: now 가 아니라 활동 startTime 기준.
const CANDIDATE_WINDOW_YEARS = 2;

/** 러닝 계열 activityType 통합 (Garmin: track_running / street_running / trail_running 등). */
const RUNNING_TYPES = new Set([
  "running",
  "track_running",
  "street_running",
  "trail_running",
  "indoor_running",
  "treadmill_running",
  "virtual_run",
  "obstacle_run",
]);

function isRunningType(t: string): boolean {
  return RUNNING_TYPES.has(t) || t.includes("running");
}

export interface StartLocation {
  lat: number;
  lng: number;
}

/**
 * Activity.rawData 에서 시작 GPS 추출. Garmin API 는 startLatitude/startLongitude 로 반환.
 * indoor / 실내 러닝은 값 없음 → null.
 */
export function getStartLocation(rawData: unknown): StartLocation | null {
  if (!rawData || typeof rawData !== "object") return null;
  const raw = rawData as {
    startLatitude?: number | null;
    startLongitude?: number | null;
  };
  const lat = raw.startLatitude;
  const lng = raw.startLongitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Garmin 은 0/0 을 "unknown" 대신 실제 좌표로 쓰지 않는다는 관례 — defensive filter.
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/** Haversine 거리 (m). 두 GPS 점 사이 대원 거리. */
export function haversineMeters(
  a: StartLocation,
  b: StartLocation,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_M * c;
}

/** Projected activity shape — findSimilarActivities 반환 및 내부 매칭에 필요한 필드만. */
export type SimilarActivity = Pick<
  Activity,
  | "id"
  | "name"
  | "activityType"
  | "startTime"
  | "duration"
  | "distance"
  | "avgHR"
  | "avgPace"
  | "intensityLabel"
  | "routeTag"
  | "rawData"
>;

/**
 * 활동 두 개가 "같은 코스" 인지 판정.
 * - 같은 activityType 계열 (running-family)
 * - GPS 시작점이 radiusMeters 이내
 * - distance 가 tolerance 이내 (±10% 등)
 * GPS 없는 활동 (실내) 은 false.
 */
export function isSameCourse(
  a: SimilarActivity,
  b: SimilarActivity,
  radiusMeters = DEFAULT_RADIUS_METERS,
  distanceTolerance = DEFAULT_DISTANCE_TOLERANCE,
): boolean {
  if (!isRunningType(a.activityType) || !isRunningType(b.activityType)) {
    return false;
  }
  if (a.distance === null || b.distance === null) return false;
  const locA = getStartLocation(a.rawData);
  const locB = getStartLocation(b.rawData);
  if (!locA || !locB) return false;
  if (haversineMeters(locA, locB) > radiusMeters) return false;
  const ratio = Math.abs(a.distance - b.distance) / a.distance;
  return ratio <= distanceTolerance;
}

export interface SimilarActivitiesOptions {
  limit?: number;
  radiusMeters?: number;
  distanceTolerance?: number;
}

/** Prisma select — SimilarActivity 프로젝션. Codex P1 #3: rawData 외 대형 Json blob (splitSummaries, zoneDistribution) 제외. */
const SIMILAR_SELECT = {
  id: true,
  name: true,
  activityType: true,
  startTime: true,
  duration: true,
  distance: true,
  avgHR: true,
  avgPace: true,
  intensityLabel: true,
  routeTag: true,
  // rawData 는 GPS 추출용 (Prisma 는 Json 서브필드 select 미지원 → 전체 로드).
  rawData: true,
} as const;

/**
 * `activityId` 와 같은 코스로 판정되는 활동 목록. 최근순.
 *   - GPS 매칭 (auto): 같은 시작점 반경 + 거리 유사
 *   - Tag 매칭 (manual): 같은 routeTag (routeTag !== null)
 * 두 축은 OR — 사용자 태그로 GPS 다른 활동도 그룹 가능.
 * 자기 자신은 제외.
 */
export async function findSimilarActivities(
  activityId: string,
  opts: SimilarActivitiesOptions = {},
): Promise<SimilarActivity[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const radiusMeters = opts.radiusMeters ?? DEFAULT_RADIUS_METERS;
  const distanceTolerance = opts.distanceTolerance ?? DEFAULT_DISTANCE_TOLERANCE;

  const current = await prisma.activity.findUnique({
    where: { id: activityId },
    select: SIMILAR_SELECT,
  });
  if (!current) return [];

  const currentLoc = getStartLocation(current.rawData);
  const currentTag = current.routeTag;

  // GPS도 없고 태그도 없으면 매칭 후보 없음 — 빠른 반환.
  if (!currentLoc && !currentTag) return [];

  // 대상 활동 startTime 기준 ±N 년 창. Codex P1 #1: now 기준이면 오래된 활동을 열었을 때 동시대 활동을 놓친다.
  const windowStart = new Date(current.startTime);
  windowStart.setFullYear(windowStart.getFullYear() - CANDIDATE_WINDOW_YEARS);
  const windowEnd = new Date(current.startTime);
  windowEnd.setFullYear(windowEnd.getFullYear() + CANDIDATE_WINDOW_YEARS);

  const candidates = await prisma.activity.findMany({
    where: {
      id: { not: activityId },
      startTime: { gte: windowStart, lte: windowEnd },
      OR: [
        // Running 계열 candidates (auto-match 대상).
        { activityType: { contains: "running" } },
        { activityType: { in: ["virtual_run", "obstacle_run"] } },
        // 태그 매칭 (activityType 제한 없음 — 사용자가 명시).
        ...(currentTag ? [{ routeTag: currentTag }] : []),
      ],
    },
    orderBy: { startTime: "desc" },
    select: SIMILAR_SELECT,
    // Codex P1 #2: 사용자별 러닝 커버 가능한 상한 (수백~수천). 드물게 뛴 코스도 놓치지 않도록.
    take: CANDIDATE_SCAN_CAP,
  });

  const matched = candidates.filter((c) => {
    // Tag 매칭 (routeTag 동일 + 값 있음) — activityType 무관.
    if (currentTag && c.routeTag === currentTag) return true;
    // Auto 매칭 (GPS + 거리)
    if (!currentLoc) return false;
    return isSameCourse(current, c, radiusMeters, distanceTolerance);
  });

  return matched.slice(0, limit);
}
