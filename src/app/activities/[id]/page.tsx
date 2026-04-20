import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import { formatDateLocal } from "@/lib/format";
import { parseZoneDistribution } from "@/lib/fitness/intensity";
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
    },
  });

  if (!activity) {
    notFound();
  }

  // M4-10: 이전 동일 유형 활동과 비교 (거리 ±10%, 최근 3개)
  const similarActivities =
    activity.distance && activity.distance > 0
      ? await prisma.activity.findMany({
          where: {
            activityType: activity.activityType,
            distance: {
              gte: activity.distance * 0.9,
              lte: activity.distance * 1.1,
            },
            startTime: { lt: activity.startTime },
          },
          orderBy: { startTime: "desc" },
          take: 3,
          select: {
            name: true,
            startTime: true,
            avgPace: true,
            avgHR: true,
            duration: true,
            distance: true,
            intensityLabel: true,
          },
        })
      : [];

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
          name: a.name,
          date: formatDateLocal(a.startTime),
          avgPace: a.avgPace,
          avgHR: a.avgHR,
          duration: a.duration,
          distanceKm: a.distance
            ? Number((a.distance / 1000).toFixed(2))
            : null,
          intensityLabel: a.intensityLabel,
        }))}
      />
    </div>
  );
}

