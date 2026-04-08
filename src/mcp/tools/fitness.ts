import prisma from "../prisma";

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
      avgSpO2: true,
      avgRespiration: true,
      lowestRespiration: true,
      highestRespiration: true,
      avgSleepStress: true,
      bodyBatteryChange: true,
      restingHR: true,
      hrvOvernight: true,
    },
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            records: records.map((r) => ({
              ...r,
              date: fmt(r.date),
              sleepStart: r.sleepStart.toISOString(),
              sleepEnd: r.sleepEnd.toISOString(),
              totalSleepHours: (r.totalSleep / 60).toFixed(1),
            })),
            _context: {
              bodyBatteryChange: "수면 중 충전량. 30+ 양호한 회복, 20-30 보통, 20 미만 회복 부족.",
              hrvOvernight: "야간 HRV. 절대값보다 7일 추세가 중요. 하락 추세 = 피로 누적, 상승 추세 = 회복 양호.",
              restingHR: "수면 중 안정시 심박. DailySummary보다 정확. 7일 평균 대비 5bpm+ 상승 시 피로/질병 의심.",
              avgSpO2: "수면 중 SpO2가 기준값. 95%+ 정상, 90% 미만 주의.",
              sleepScore: "0-100 점수. 80+ 양호, 60-80 보통, 60 미만 부족.",
            },
          },
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
      bodyBatteryCharged: true,
      bodyBatteryDrained: true,
      intensityMin: true,
      floorsClimbed: true,
      avgSpo2: true,
      lowestSpo2: true,
      avgRespiration: true,
      stressHighDuration: true,
      stressMediumDuration: true,
      stressLowDuration: true,
    },
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            records: records.map((r) => ({ ...r, date: fmt(r.date) })),
            _context: {
              bodyBattery: "bodyBattery(현재값)는 하루 중 자연 소모 결과이므로 저녁에 낮은 것은 정상. 컨디션 판단은 bodyBatteryHigh(기상 시 충전값) 기준: 70+ 양호, 40-70 보통, 40 미만 피로. 회복 판단은 bodyBatteryCharged(충전량) 기준: 40+ 양호한 회복.",
              stress: "avgStress는 운동 포함 하루 평균이므로 높을 수 있음. 실제 스트레스 수준은 stressHighDuration(고스트레스 시간)과 stressLowDuration(저스트레스 시간) 비율로 판단. 운동 중 고스트레스는 정상.",
              restingHR: "DailySummary.restingHR은 주간 활동 영향을 받음. 수면 중 측정값(SleepRecord.restingHR)이 더 정확. 추세가 중요: 7일 평균 대비 5bpm 이상 상승 시 피로/질병 의심.",
              spo2: "주간 SpO2는 측정 환경에 따라 변동이 큼. 수면 중 SpO2(SleepRecord.avgSpO2)가 기준값. 95%+ 정상, 90% 미만 주의.",
            },
          },
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
