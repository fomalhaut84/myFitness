import prisma from "../../lib/prisma";

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmt(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function getActivities(args: { days?: number; type?: string }) {
  const since = daysAgo(args.days ?? 14);
  const where = args.type
    ? { startTime: { gte: since }, activityType: { contains: args.type } }
    : { startTime: { gte: since } };

  const activities = await prisma.activity.findMany({
    where,
    orderBy: { startTime: "desc" },
    select: {
      name: true,
      activityType: true,
      startTime: true,
      duration: true,
      distance: true,
      avgPace: true,
      avgHR: true,
      maxHR: true,
      calories: true,
      elevationGain: true,
      trainingEffect: true,
      vo2maxEstimate: true,
    },
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          activities.map((a) => ({
            ...a,
            startTime: a.startTime.toISOString(),
            distanceKm: a.distance ? (a.distance / 1000).toFixed(2) : null,
            paceMinKm: a.avgPace
              ? `${Math.floor(a.avgPace / 60)}'${Math.round(a.avgPace % 60).toString().padStart(2, "0")}"`
              : null,
            durationMin: Math.round(a.duration / 60),
          })),
          null,
          2
        ),
      },
    ],
  };
}

export async function getSleep(args: { days?: number }) {
  const since = daysAgo(args.days ?? 14);
  const records = await prisma.sleepRecord.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "desc" },
    select: {
      date: true,
      totalSleep: true,
      deepSleep: true,
      lightSleep: true,
      remSleep: true,
      awakeDuration: true,
      sleepScore: true,
      sleepStart: true,
      sleepEnd: true,
    },
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          records.map((r) => ({
            ...r,
            date: fmt(r.date),
            sleepStart: r.sleepStart.toISOString(),
            sleepEnd: r.sleepEnd.toISOString(),
            totalSleepHours: (r.totalSleep / 60).toFixed(1),
          })),
          null,
          2
        ),
      },
    ],
  };
}

export async function getHeartRate(args: { days?: number }) {
  const since = daysAgo(args.days ?? 30);
  const records = await prisma.heartRateRecord.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "desc" },
    select: {
      date: true,
      restingHR: true,
      avgHR: true,
      maxHR: true,
      minHR: true,
      hrvStatus: true,
    },
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          records.map((r) => ({ ...r, date: fmt(r.date) })),
          null,
          2
        ),
      },
    ],
  };
}

export async function getDailyStats(args: { days?: number }) {
  const since = daysAgo(args.days ?? 14);
  const records = await prisma.dailySummary.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "desc" },
    select: {
      date: true,
      steps: true,
      totalCalories: true,
      activeCalories: true,
      restingHR: true,
      avgStress: true,
      bodyBattery: true,
      bodyBatteryHigh: true,
      bodyBatteryLow: true,
      intensityMin: true,
      floorsClimbed: true,
    },
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          records.map((r) => ({ ...r, date: fmt(r.date) })),
          null,
          2
        ),
      },
    ],
  };
}

export async function getBodyComposition(args: { days?: number }) {
  const since = daysAgo(args.days ?? 90);
  const records = await prisma.bodyComposition.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "desc" },
    select: {
      date: true,
      weight: true,
      bmi: true,
      bodyFat: true,
      muscleMass: true,
    },
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          records.map((r) => ({ ...r, date: fmt(r.date) })),
          null,
          2
        ),
      },
    ],
  };
}

export async function getTrends(args: { period: string }) {
  const days = args.period === "month" ? 30 : 7;
  const since = daysAgo(days);

  const [activities, dailyStats, sleepRecords] = await Promise.all([
    prisma.activity.findMany({
      where: { startTime: { gte: since } },
      select: { activityType: true, distance: true, duration: true, calories: true },
    }),
    prisma.dailySummary.findMany({
      where: { date: { gte: since } },
      select: { steps: true, activeCalories: true, avgStress: true, bodyBattery: true },
    }),
    prisma.sleepRecord.findMany({
      where: { date: { gte: since } },
      select: { totalSleep: true, sleepScore: true },
    }),
  ]);

  const avg = (arr: (number | null)[]) => {
    const valid = arr.filter((v): v is number => v !== null);
    return valid.length > 0 ? Math.round(valid.reduce((s, v) => s + v, 0) / valid.length) : null;
  };

  const totalDistance = activities.reduce((s, a) => s + (a.distance ?? 0), 0);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            period: args.period,
            days,
            activities: {
              count: activities.length,
              totalDistanceKm: (totalDistance / 1000).toFixed(2),
              totalDurationMin: Math.round(activities.reduce((s, a) => s + a.duration, 0) / 60),
              totalCalories: activities.reduce((s, a) => s + (a.calories ?? 0), 0),
            },
            daily: {
              avgSteps: avg(dailyStats.map((d) => d.steps)),
              avgActiveCalories: avg(dailyStats.map((d) => d.activeCalories)),
              avgStress: avg(dailyStats.map((d) => d.avgStress)),
              avgBodyBattery: avg(dailyStats.map((d) => d.bodyBattery)),
            },
            sleep: {
              avgTotalSleepMin: avg(sleepRecords.map((s) => s.totalSleep)),
              avgSleepScore: avg(sleepRecords.map((s) => s.sleepScore)),
            },
          },
          null,
          2
        ),
      },
    ],
  };
}
