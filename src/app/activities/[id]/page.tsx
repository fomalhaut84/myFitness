import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import { formatDateLocal } from "@/lib/format";
import { parseZoneDistribution } from "@/lib/fitness/intensity";
import { findSimilarActivities } from "@/lib/activity/similar-activities";
import { isRunningType } from "@/lib/activity/running-types";
import ActivityDetailClient from "./activity-detail-client";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ActivityDetailPage({ params }: PageProps) {
  const { id } = await params;

  const activity = await prisma.activity.findUnique({
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
      // M4-5: 강도 자동 분류
      zoneDistribution: true,
      estimatedZone: true,
      intensityScore: true,
      intensityLabel: true,
      // #261: 사용자 커스텀 코스명 태그
      routeTag: true,
    },
  });

  if (!activity) {
    notFound();
  }

  // #261: 같은 코스 활동 매칭 (GPS 시작점 반경 + 거리 유사, 또는 같은 routeTag).
  // 기존 M4-10 은 activityType + distance ±10% 만 사용 (지역 무관, 오탐 다수) → 대체.
  // Codex P2: 러닝 계열에서만 호출 (non-running 활동은 섹션 자체를 렌더 안 함 → 쿼리 비용 절감).
  const similarRaw = isRunningType(activity.activityType)
    ? await findSimilarActivities(id, { limit: 10 })
    : [];
  const similarActivities = similarRaw.map((a) => ({
    id: a.id,
    name: a.name,
    startTime: a.startTime,
    avgPace: a.avgPace,
    avgHR: a.avgHR,
    duration: a.duration,
    distance: a.distance,
    intensityLabel: a.intensityLabel,
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
          routeTag: a.routeTag,
        }))}
      />
    </div>
  );
}

