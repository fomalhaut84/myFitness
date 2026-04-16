import prisma from "../prisma";
import { withReauth } from "@/lib/garmin/client";

interface RawLapDTO {
  distance?: number; // meters
  duration?: number; // seconds
  averageSpeed?: number; // m/s
  averageHR?: number;
  maxHR?: number;
  averageRunCadence?: number;
  elevationGain?: number;
  averagePower?: number;
  intensityType?: string; // ACTIVE / WARMUP / COOLDOWN / INTERVAL / REST
  lapIndex?: number;
}

interface LapResponse {
  lapIndex: number;
  distanceKm: number | null;
  durationSec: number | null;
  durationMin: string | null;
  paceSecPerKm: number | null;
  paceMinKm: string | null;
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

function toLapResponse(lap: RawLapDTO, index: number): LapResponse {
  const speed = lap.averageSpeed ?? null;
  const paceSecPerKm =
    speed !== null && speed > 0 ? Math.round(1000 / speed) : null;
  return {
    lapIndex: lap.lapIndex ?? index + 1,
    distanceKm:
      lap.distance !== undefined
        ? Number((lap.distance / 1000).toFixed(3))
        : null,
    durationSec: lap.duration ?? null,
    durationMin:
      lap.duration !== undefined
        ? `${Math.floor(lap.duration / 60)}:${String(
            Math.round(lap.duration % 60)
          ).padStart(2, "0")}`
        : null,
    paceSecPerKm,
    paceMinKm: paceSecPerKm !== null ? formatPace(paceSecPerKm) + "/km" : null,
    avgHR: lap.averageHR ?? null,
    maxHR: lap.maxHR ?? null,
    avgCadence:
      lap.averageRunCadence !== undefined
        ? Math.round(lap.averageRunCadence)
        : null,
    elevationGain:
      lap.elevationGain !== undefined ? Math.round(lap.elevationGain) : null,
    avgPower: lap.averagePower !== undefined ? Math.round(lap.averagePower) : null,
    intensityType: lap.intensityType ?? null,
  };
}

/**
 * 특정 활동의 km별(lap별) 상세 데이터 조회.
 * activityId는 DB id(cuid) 또는 Garmin garminId 문자열 허용.
 */
export async function getActivitySplits(args: { activityId: string }) {
  const { activityId } = args;
  if (!activityId) {
    return errorPayload("activityId가 필요합니다");
  }

  // DB에서 Activity 조회 (cuid 또는 garminId)
  const activity = await prisma.activity.findFirst({
    where: {
      OR: [
        { id: activityId },
        // garminId는 BigInt. 숫자로 파싱 가능할 때만 시도.
        ...(/^\d+$/.test(activityId)
          ? [{ garminId: BigInt(activityId) }]
          : []),
      ],
    },
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

  if (!activity) {
    return errorPayload(`활동을 찾을 수 없습니다: ${activityId}`);
  }

  // Garmin API로 splits 조회
  let rawLaps: RawLapDTO[] = [];
  try {
    const splits = await withReauth(async (client) =>
      client.get<{ lapDTOs?: RawLapDTO[] }>(
        `https://connectapi.garmin.com/activity-service/activity/${activity.garminId}/splits`
      )
    );
    rawLaps = splits.lapDTOs ?? [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorPayload(`Garmin splits 조회 실패: ${message}`);
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
    totalDurationMin: Math.round(activity.duration / 60),
    lapCount: laps.length,
    kmLapCount: activeKmLaps.length,
    paceRangeMinKm: minPace !== null ? formatPace(minPace) + "/km" : null,
    paceRangeMaxKm: maxPace !== null ? formatPace(maxPace) + "/km" : null,
    avgPaceMinKm: avgPace !== null ? formatPace(avgPace) + "/km" : null,
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
