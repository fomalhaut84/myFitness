import prisma from "../prisma";

interface RawLapDTO {
  distance?: number | null; // meters
  duration?: number | null; // seconds
  averageSpeed?: number | null; // m/s
  averageHR?: number | null;
  maxHR?: number | null;
  averageRunCadence?: number | null;
  elevationGain?: number | null;
  averagePower?: number | null;
  intensityType?: string | null; // ACTIVE / WARMUP / COOLDOWN / INTERVAL / REST
  lapIndex?: number | null;
}

interface LapResponse {
  lapIndex: number;
  distanceKm: number | null;
  durationSec: number | null;
  durationFormatted: string | null; // "M:SS"
  paceSecPerKm: number | null;
  paceFormatted: string | null; // "M:SS/km"
  avgHR: number | null;
  maxHR: number | null;
  avgCadence: number | null;
  elevationGain: number | null;
  avgPower: number | null;
  intensityType: string | null;
}

function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function formatDuration(totalSec: number): string {
  const total = Math.round(totalSec);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function toLapResponse(lap: RawLapDTO, index: number): LapResponse {
  // Garmin 페이로드는 null 또는 undefined로 누락된 값을 반환할 수 있음.
  // `!= null` 로 null/undefined 모두 누락으로 처리 (0으로 강제 변환 방지).
  const speed = lap.averageSpeed;
  const paceSecPerKm =
    speed != null && speed > 0 ? Math.round(1000 / speed) : null;
  return {
    lapIndex: lap.lapIndex ?? index + 1,
    distanceKm:
      lap.distance != null
        ? Number((lap.distance / 1000).toFixed(3))
        : null,
    durationSec: lap.duration ?? null,
    durationFormatted:
      lap.duration != null ? formatDuration(lap.duration) : null,
    paceSecPerKm,
    paceFormatted:
      paceSecPerKm !== null ? formatPace(paceSecPerKm) + "/km" : null,
    avgHR: lap.averageHR ?? null,
    maxHR: lap.maxHR ?? null,
    avgCadence:
      lap.averageRunCadence != null
        ? Math.round(lap.averageRunCadence)
        : null,
    elevationGain:
      lap.elevationGain != null ? Math.round(lap.elevationGain) : null,
    avgPower: lap.averagePower != null ? Math.round(lap.averagePower) : null,
    intensityType: lap.intensityType ?? null,
  };
}

// PostgreSQL bigint 범위 (signed 64-bit)
const BIGINT_MAX = BigInt("9223372036854775807");
const BIGINT_ZERO = BigInt(0);

/** activityId 문자열을 BigInt garminId로 안전 변환 (범위 초과/포맷 오류 시 null) */
function tryParseGarminId(activityId: string): bigint | null {
  if (!/^\d+$/.test(activityId)) return null;
  try {
    const value = BigInt(activityId);
    if (value > BIGINT_MAX || value < BIGINT_ZERO) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * 특정 활동의 km별(lap별) 상세 데이터 조회.
 * activityId는 DB id(cuid) 또는 Garmin garminId 문자열 허용.
 */
export async function getActivitySplits(args: { activityId: string }) {
  const activityId = args.activityId?.trim();
  if (!activityId) {
    return errorPayload("activityId가 필요합니다");
  }

  const garminIdCandidate = tryParseGarminId(activityId);
  const orClauses: Array<{ id: string } | { garminId: bigint }> = [
    { id: activityId },
  ];
  if (garminIdCandidate !== null) {
    orClauses.push({ garminId: garminIdCandidate });
  }

  // DB에서 Activity 조회 (cuid 또는 garminId). Prisma 예외는 errorPayload로 변환.
  let activity;
  try {
    activity = await prisma.activity.findFirst({
      where: { OR: orClauses },
      select: {
        id: true,
        garminId: true,
        activityType: true,
        name: true,
        startTime: true,
        distance: true,
        duration: true,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorPayload(`활동 조회 실패: ${message}`);
  }

  if (!activity) {
    return errorPayload(`활동을 찾을 수 없습니다: ${activityId}`);
  }

  // 내부 API 경유로 splits 조회 (MCP는 별도 프로세스라 Garmin client 직접 사용 불가).
  // Next.js 서버의 /api/activities/[id]/splits 를 localhost로 호출.
  const port = process.env.PORT ?? "4200";
  let rawLaps: RawLapDTO[] = [];
  try {
    const res = await fetch(
      `http://localhost:${port}/api/activities/${activity.id}/splits`
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      return errorPayload(
        `Splits 조회 실패 (${res.status}): ${body?.error ?? res.statusText}`
      );
    }
    const body = await res.json();
    rawLaps = (body.data as RawLapDTO[]) ?? [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorPayload(`Splits API 호출 실패: ${message}`);
  }

  const laps = rawLaps.map(toLapResponse);

  // 요약
  const activeKmLaps = rawLaps.filter(
    (l) => (l.distance ?? 0) >= 900 && (l.distance ?? 0) <= 1100
  );
  const paces = activeKmLaps
    .map((l) => (l.averageSpeed && l.averageSpeed > 0 ? 1000 / l.averageSpeed : null))
    .filter((p): p is number => p !== null);
  const minPace = paces.length > 0 ? Math.min(...paces) : null;
  const maxPace = paces.length > 0 ? Math.max(...paces) : null;
  const avgPace =
    paces.length > 0 ? paces.reduce((s, p) => s + p, 0) / paces.length : null;

  const summary = {
    activityId: activity.id,
    garminId: activity.garminId.toString(),
    activityType: activity.activityType,
    name: activity.name,
    startTime: activity.startTime.toISOString(),
    totalDistanceKm:
      activity.distance !== null
        ? Number((activity.distance / 1000).toFixed(2))
        : null,
    totalDurationSec: activity.duration,
    totalDurationFormatted: formatDuration(activity.duration),
    lapCount: laps.length,
    kmLapCount: activeKmLaps.length,
    paceMinFormatted: minPace !== null ? formatPace(minPace) + "/km" : null,
    paceMaxFormatted: maxPace !== null ? formatPace(maxPace) + "/km" : null,
    paceAvgFormatted: avgPace !== null ? formatPace(avgPace) + "/km" : null,
  };

  const response = {
    _context:
      "km별(Lap별) 구간 데이터입니다. 한계치 런은 목표 페이스 유지 여부(paceRangeMin~Max 편차)를, " +
      "인터벌은 intensityType별 고/저 구간 페이스 차이를, 이지런은 Zone 2 심박 유지 여부를 분석하세요.",
    summary,
    laps,
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}

function errorPayload(message: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: message }, null, 2),
      },
    ],
    isError: true,
  };
}
