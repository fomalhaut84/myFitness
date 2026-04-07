import prisma from "@/lib/prisma";
import ActivitiesClient from "./activities-client";

export const dynamic = "force-dynamic";

export default async function ActivitiesPage() {
  const activities = await prisma.activity.findMany({
    orderBy: { startTime: "desc" },
    take: 20,
    select: {
      id: true,
      name: true,
      activityType: true,
      startTime: true,
      duration: true,
      distance: true,
      avgPace: true,
      avgHR: true,
      calories: true,
    },
  });

  // 이번 달 러닝 요약
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const monthlyRunning = await prisma.activity.findMany({
    where: {
      activityType: { contains: "running" },
      startTime: { gte: monthStart },
    },
    select: {
      distance: true,
      duration: true,
      avgPace: true,
    },
  });

  const monthSummary = {
    count: monthlyRunning.length,
    totalDistance: monthlyRunning.reduce((sum, a) => sum + (a.distance ?? 0), 0),
    totalDuration: monthlyRunning.reduce((sum, a) => sum + a.duration, 0),
    avgPace:
      monthlyRunning.length > 0
        ? monthlyRunning
            .filter((a) => a.avgPace !== null)
            .reduce((sum, a) => sum + (a.avgPace ?? 0), 0) /
          monthlyRunning.filter((a) => a.avgPace !== null).length
        : null,
  };

  return (
    <ActivitiesClient
      activities={activities.map((a) => ({
        ...a,
        startTime: a.startTime.toISOString(),
      }))}
      monthSummary={monthSummary}
    />
  );
}
