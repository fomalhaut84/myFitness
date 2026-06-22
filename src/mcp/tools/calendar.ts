import prisma from "../prisma";
import { todayKST, daysAgoKST, todayKSTString, ymdKST } from "../../lib/garmin/utils";

function round(n: number, digits = 2): number {
  const factor = Math.pow(10, digits);
  return Math.round(n * factor) / factor;
}

interface DayItem {
  date: string;
  runningKm: number;
  runningCount: number;
  restingHR: number | null;
  sleepScore: number | null;
  sleepHours: number | null;
  bodyBatteryHigh: number | null;
  calorieBalance: number | null;
  steps: number | null;
}

/**
 * N일 일자별 핵심 지표 한 줄씩 (최신순).
 * AI가 주간/월간 리포트에서 일자별 상황을 한 번의 호출로 훑을 수 있게.
 */
export async function getCalendarSummary(args: { days?: number } = {}) {
  const days = Math.min(90, Math.max(1, args.days ?? 14));
  const since = daysAgoKST(days - 1);
  const tomorrow = new Date(todayKST());
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const [runs, sleeps, dailies] = await Promise.all([
    prisma.activity.findMany({
      where: {
        startTime: { gte: since, lt: tomorrow },
        activityType: { contains: "running" },
      },
      select: { startTime: true, distance: true },
    }),
    prisma.sleepRecord.findMany({
      where: { date: { gte: since, lt: tomorrow } },
      select: {
        date: true,
        sleepScore: true,
        totalSleep: true,
        restingHR: true,
      },
    }),
    prisma.dailySummary.findMany({
      where: { date: { gte: since, lt: tomorrow } },
      select: {
        date: true,
        restingHR: true,
        bodyBatteryHigh: true,
        calorieBalance: true,
        steps: true,
      },
    }),
  ]);

  const runMap = new Map<string, { distanceM: number; count: number }>();
  for (const r of runs) {
    const key = ymdKST(r.startTime);
    const entry = runMap.get(key) ?? { distanceM: 0, count: 0 };
    entry.distanceM += r.distance ?? 0;
    entry.count += 1;
    runMap.set(key, entry);
  }

  type SleepRow = (typeof sleeps)[number];
  const sleepMap = new Map<string, SleepRow>();
  for (const s of sleeps) sleepMap.set(ymdKST(s.date), s);

  type DailyRow = (typeof dailies)[number];
  const dailyMap = new Map<string, DailyRow>();
  for (const d of dailies) dailyMap.set(ymdKST(d.date), d);

  const today = todayKST();
  const items: DayItem[] = [];
  for (let i = 0; i < days; i++) {
    const dayInstant = new Date(today);
    dayInstant.setUTCDate(dayInstant.getUTCDate() - i);
    const key = ymdKST(dayInstant);
    const run = runMap.get(key);
    const sleep = sleepMap.get(key);
    const daily = dailyMap.get(key);
    items.push({
      date: key,
      runningKm: run ? round(run.distanceM / 1000, 2) : 0,
      runningCount: run?.count ?? 0,
      restingHR: sleep?.restingHR ?? daily?.restingHR ?? null,
      sleepScore: sleep?.sleepScore ?? null,
      // sleep 객체 존재 여부로 판단 (totalSleep === 0 도 "기록은 있는 0분" 으로 보존)
      sleepHours: sleep ? round(sleep.totalSleep / 60, 1) : null,
      bodyBatteryHigh: daily?.bodyBatteryHigh ?? null,
      calorieBalance: daily?.calorieBalance ?? null,
      steps: daily?.steps ?? null,
    });
  }

  const totalRunningKm = round(
    items.reduce((a, b) => a + b.runningKm, 0),
    2
  );
  const totalRunningCount = items.reduce((a, b) => a + b.runningCount, 0);
  const daysWithRun = items.filter((i) => i.runningCount > 0).length;
  const sleepScores = items
    .map((i) => i.sleepScore)
    .filter((s): s is number => s !== null);
  const avgSleepScore =
    sleepScores.length > 0
      ? Math.round(sleepScores.reduce((a, b) => a + b, 0) / sleepScores.length)
      : null;

  const payload = {
    date: todayKSTString(),
    days,
    summary: {
      totalRunningKm,
      totalRunningCount,
      daysWithRun,
      avgSleepScore,
    },
    items,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}
