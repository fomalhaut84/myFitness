import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import { formatDateLocal } from "@/lib/format";
import { parseZoneDistribution } from "@/lib/fitness/intensity";
import { applyIntensityBasis, INTENSITY_SELECT, selectIntensityLabel } from "@/lib/fitness/intensity-select";
import { loadIntensityContext } from "@/lib/fitness/intensity-setting";
import { resolveProfilePowerZones } from "@/lib/fitness/power-zones";
import { resolveLTHR, resolveMaxHR, resolveProfileHrZones } from "@/lib/fitness/zones";
import type { IntensityExtras } from "./activity-detail-client";
import { findSimilarActivities } from "@/lib/activity/similar-activities";
import { isRunningType } from "@/lib/activity/running-types";
import { loadActivityRecovery } from "@/lib/heart/load-recovery";
import ActivityDetailClient from "./activity-detail-client";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ActivityDetailPage({ params }: PageProps) {
  const { id } = await params;

  const [row, basis, profile] = await Promise.all([prisma.activity.findUnique({
    where: { id },
    select: {
      name: true,
      activityType: true,
      startTime: true,
      duration: true,
      distance: true,
      calories: true,
      avgHR: true,
      maxHR: true,
      avgPace: true,
      avgSpeed: true,
      elevationGain: true,
      trainingEffect: true,
      vo2maxEstimate: true,
      avgCadence: true,
      avgStrideLength: true,
      avgVerticalOscillation: true,
      avgGroundContactTime: true,
      aerobicTE: true,
      anaerobicTE: true,
      avgRespirationRate: true,
      lapCount: true,
      // M4-5: 강도 자동 분류 · #570 러닝 파워 기준 (프로필 기준으로 고른다)
      ...INTENSITY_SELECT,
      // #261: 사용자 커스텀 코스명 태그
      routeTag: true,
      // #269: 손목 온도 (Garmin) + 외부 기상 (Open-Meteo)
      wristTempMaxC: true,
      wristTempMinC: true,
      weatherTempC: true,
      weatherApparentTempC: true,
      weatherHumidityPct: true,
      weatherWindMs: true,
      weatherPrecipMm: true,
      weatherCode: true,
    },
  }), loadIntensityContext(prisma), prisma.userProfile.findFirst({ select: PROFILE_ZONE_SELECT })]);

  if (!row) {
    notFound();
  }
  const activity = applyIntensityBasis(row, basis);
  const intensityExtras = buildIntensityExtras(row, activity.intensityBasis, profile);

  // #261: 같은 코스 활동 매칭 (GPS 시작점 반경 + 거리 유사, 또는 같은 routeTag).
  // 기존 M4-10 은 activityType + distance ±10% 만 사용 (지역 무관, 오탐 다수) → 대체.
  // Codex P2: 러닝 계열에서만 호출 (non-running 활동은 섹션 자체를 렌더 안 함 → 쿼리 비용 절감).
  // #418: 종료 후 회복 곡선도 러닝 계열만 (하루치 심박 시계열 1~2행 · 활동 rawData 는 로더 안에서만 읽는다).
  const running = isRunningType(activity.activityType);
  const [similarRaw, recovery] = await Promise.all([
    running ? findSimilarActivities(id, { limit: 10 }) : Promise.resolve([]),
    running ? loadActivityRecovery(id) : Promise.resolve(null),
  ]);
  const similarActivities = similarRaw.map((a) => ({
    id: a.id,
    name: a.name,
    startTime: a.startTime,
    avgPace: a.avgPace,
    avgHR: a.avgHR,
    duration: a.duration,
    distance: a.distance,
    ...(() => {
      const { label, basis: labelBasis } = selectIntensityLabel(a, basis);
      return { intensityLabel: label, intensityBasis: labelBasis };
    })(),
    routeTag: a.routeTag,
  }));

  return (
    <div>
      <Link
        href="/activities"
        className="inline-flex items-center gap-1.5 text-[13px] text-sub hover:text-bright transition-colors mb-6"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 12L6 8l4-4" />
        </svg>
        활동 목록
      </Link>

      <ActivityDetailClient
        activity={{
          id,
          ...activity,
          startTime: activity.startTime.toISOString(),
          zoneDistribution: parseZoneDistribution(activity.zoneDistribution),
        }}
        recovery={recovery}
        similarActivities={similarActivities.map((a) => ({
          id: a.id,
          name: a.name,
          date: formatDateLocal(a.startTime),
          startTimeIso: a.startTime.toISOString(),
          avgPace: a.avgPace,
          avgHR: a.avgHR,
          duration: a.duration,
          distanceKm: a.distance
            ? Number((a.distance / 1000).toFixed(2))
            : null,
          intensityLabel: a.intensityLabel,
          intensityBasis: a.intensityBasis,
          routeTag: a.routeTag,
        }))}
        intensityExtras={intensityExtras}
      />
    </div>
  );
}


const PROFILE_ZONE_SELECT = {
  lthr: true,
  maxHR: true,
  birthDate: true,
  maxHRSource: true,
  lthrSource: true,
  heartRateZonesRaw: true,
  thresholdPower: true,
  thresholdPowerSource: true,
  powerZonesRaw: true,
} as const;

/**
 * #570: 강도 분석 보조 — 고른 기준의 존 경계 · 역치 · (두 값이 다 있으면) 심박 · 파워 나란히.
 * 존 경계는 현재 프로필 기준 — 심박 · 파워 모두 최신 Garmin 존 하한 우선 (분포가 Garmin 존으로 센 시간이라 같은 모델 ·
 * 사전 리뷰 major), 없거나 뒤처지면 비율 계산. 활동 당시 Garmin 존과는 다를 수 있다.
 */
function buildIntensityExtras(
  row: { avgHR: number | null; zoneDistribution: unknown; intensityLabel: string | null; intensityScore: number | null; powerZoneDistribution: unknown; powerIntensityLabel: string | null; powerIntensityScore: number | null },
  basis: "hr" | "power" | null,
  profile: {
    lthr: number | null;
    maxHR: number | null;
    birthDate: Date | null;
    maxHRSource: string | null;
    lthrSource: string | null;
    heartRateZonesRaw: unknown;
    thresholdPower: number | null;
    thresholdPowerSource: string | null;
    powerZonesRaw: unknown;
  } | null
): IntensityExtras {
  const lthr = resolveLTHR(profile ?? {});
  const lthrEstimated = !profile?.lthr;
  const power = profile ? resolveProfilePowerZones(profile) : null;
  const hrDist = parseZoneDistribution(row.zoneDistribution);
  const powerDist = parseZoneDistribution(row.powerZoneDistribution);
  return {
    thresholdText:
      basis === "power"
        ? power ? `역치파워 ${power.thresholdPower} W` : null
        : `LTHR ${lthr} bpm${lthrEstimated ? " (추정)" : ""}`,
    ranges:
      basis === "power"
        ? power?.zones ?? null
        : profile
          ? resolveProfileHrZones(profile, { maxHR: resolveMaxHR(profile), lthr }).zones
          : null,
    compare:
      hrDist && powerDist
        ? {
            hr: { dist: hrDist, label: row.intensityLabel, score: row.intensityScore },
            power: { dist: powerDist, label: row.powerIntensityLabel, score: row.powerIntensityScore },
          }
        : null,
    avgHrNote: row.avgHR
      ? `평균 심박 ${row.avgHR} bpm (${lthrEstimated ? "추정 " : ""}LTHR 대비 ${Math.round((row.avgHR / lthr) * 100)}%)`
      : null,
  };
}
