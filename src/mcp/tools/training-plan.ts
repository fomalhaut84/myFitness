// M6-1: generate_training_plan + get_active_training_plan MCP 도구.

import prisma from "../prisma";
import {
  todayKST,
  daysAgoKST,
  todayKSTString,
  ymdKST,
} from "../../lib/garmin/utils";
import { formatPace } from "./running-buckets";
import { generatePlan, type GeneratedWorkout } from "../../lib/training/plan-generator";

const DAY_MS = 24 * 60 * 60 * 1000;
const BASELINE_WINDOW_DAYS = 28;
const ACWR_ACUTE_DAYS = 7;
const MIN_BASELINE_WEEKLY_KM = 15;
const LOW_VOLUME_THRESHOLD_KM_PER_WEEK = 5; // 이 미만이면 baseline 을 MIN 으로 대체
const ACTIVE_PLAN_LOCK_KEY = 761101; // pg_advisory_xact_lock 키 (임의 상수)
const TARGET_DISTANCES = ["5K", "10K", "HM", "FM"] as const;
type TargetDistance = (typeof TARGET_DISTANCES)[number];

/**
 * KST 벽시계 날짜(YYYY-MM-DD)에 해당하는 UTC midnight instant.
 * Prisma `@db.Date` 컬럼은 date-only 라 UTC 기준으로 잘림 → 이 helper 로 저장하면
 * KST 벽시계 날짜와 DB 저장 날짜가 일치.
 */
function toUtcDateOnly(kstInstant: Date): Date {
  const ymd = ymdKST(kstInstant);
  return new Date(`${ymd}T00:00:00.000Z`);
}

interface GenerateInput {
  weeklyFrequency?: number;
  targetDistance?: string;
  targetDate?: string; // "YYYY-MM-DD"
}

/** KST 자정 Date 로 변환. 유효하지 않으면 null. */
function parseKstDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function computeBaseline(): Promise<{
  weeklyKm: number;
  acwr: number | null;
  recentAvgPace: number | null;
}> {
  const since = daysAgoKST(BASELINE_WINDOW_DAYS - 1);
  const tomorrow = new Date(todayKST().getTime() + DAY_MS);
  const rows = await prisma.activity.findMany({
    where: {
      startTime: { gte: since, lt: tomorrow },
      activityType: { contains: "running" },
      distance: { not: null },
    },
    select: { startTime: true, distance: true, avgPace: true },
  });

  if (rows.length === 0) {
    return { weeklyKm: MIN_BASELINE_WEEKLY_KM, acwr: null, recentAvgPace: null };
  }

  const totalKm = rows.reduce((sum, r) => sum + (r.distance ?? 0) / 1000, 0);
  const rawWeeklyKm = totalKm / 4;
  // 스펙: 주간 < 5 km 인 저볼륨/신규 사용자에만 15 km 기본. 그 외에는 실측 유지.
  const weeklyKm =
    rawWeeklyKm < LOW_VOLUME_THRESHOLD_KM_PER_WEEK ? MIN_BASELINE_WEEKLY_KM : rawWeeklyKm;

  const acuteSince = daysAgoKST(ACWR_ACUTE_DAYS - 1);
  const acuteKm = rows
    .filter((r) => r.startTime >= acuteSince)
    .reduce((sum, r) => sum + (r.distance ?? 0) / 1000, 0);
  const acuteDaily = acuteKm / ACWR_ACUTE_DAYS;
  const chronicDaily = totalKm / BASELINE_WINDOW_DAYS;
  const acwr = chronicDaily > 0 ? Math.round((acuteDaily / chronicDaily) * 100) / 100 : null;

  const pacedRows = rows.filter((r) => r.avgPace !== null);
  const recentAvgPace =
    pacedRows.length > 0
      ? pacedRows.reduce((sum, r) => sum + (r.avgPace ?? 0), 0) / pacedRows.length
      : null;

  return {
    weeklyKm: Math.round(weeklyKm * 10) / 10,
    acwr,
    recentAvgPace: recentAvgPace !== null ? Math.round(recentAvgPace) : null,
  };
}

function validateTargetDistance(v: string | undefined): TargetDistance | null {
  if (!v) return null;
  return TARGET_DISTANCES.includes(v as TargetDistance)
    ? (v as TargetDistance)
    : null;
}

function summarizeWorkout(w: GeneratedWorkout): Record<string, unknown> {
  const base: Record<string, unknown> = {
    date: ymdKST(w.date),
    type: w.type,
  };
  if (w.distanceKm !== null) base.distanceKm = w.distanceKm;
  if (w.paceSecPerKm !== null) base.pace = formatPace(w.paceSecPerKm);
  if (w.zone !== null) base.zone = w.zone;
  if (w.intervalDesc !== null) base.interval = w.intervalDesc;
  return base;
}

export async function generateTrainingPlan(input: GenerateInput = {}) {
  const rawFreq = input.weeklyFrequency ?? 4;
  const weeklyFrequency = Math.min(5, Math.max(3, Math.round(rawFreq)));
  const targetDistance = validateTargetDistance(input.targetDistance);

  const targetDate =
    input.targetDate !== undefined ? parseKstDate(input.targetDate) : null;
  if (input.targetDate !== undefined && targetDate === null) {
    throw new Error(`유효하지 않은 targetDate: ${input.targetDate} (YYYY-MM-DD 형식 필요)`);
  }
  if (targetDate !== null && targetDistance === null) {
    throw new Error("targetDate 를 지정하려면 targetDistance 도 함께 지정해야 합니다.");
  }

  // 프로필 + baseline
  const profile = await prisma.userProfile.findFirst({
    select: { lthrPace: true },
  });
  const lthrPace = profile?.lthrPace ?? null;
  const baseline = await computeBaseline();

  const startDate = new Date(todayKST().getTime() + DAY_MS); // 내일
  const endDate = new Date(startDate.getTime() + 27 * DAY_MS);

  // targetDate 범위 검증: plan 창 내에 있어야 tapering 적용 (아니면 무시).
  const effectiveTargetDate =
    targetDate !== null && targetDate >= startDate && targetDate <= endDate
      ? targetDate
      : null;

  const workouts = generatePlan({
    startDate,
    weeklyFrequency,
    baselineWeeklyKm: baseline.weeklyKm,
    lthrPaceSecPerKm: lthrPace,
    recentAvgPaceSecPerKm: baseline.recentAvgPace,
    targetDistance,
    targetDate: effectiveTargetDate,
  });

  const lthrPaceUsed =
    lthrPace ??
    (baseline.recentAvgPace !== null ? baseline.recentAvgPace / 1.10 : null);

  // 트랜잭션: advisory lock 으로 archive+create 구간 직렬화 (동시 호출 시 중복 active 방지).
  // 이후 기존 active 아카이빙 + 신규 plan + workouts insert.
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ACTIVE_PLAN_LOCK_KEY})`;

    const archivedActive = await tx.trainingPlan.findMany({
      where: { status: "active" },
      select: { id: true },
    });
    if (archivedActive.length > 0) {
      await tx.trainingPlan.updateMany({
        where: { id: { in: archivedActive.map((p) => p.id) } },
        data: { status: "archived" },
      });
    }

    const plan = await tx.trainingPlan.create({
      data: {
        startDate: toUtcDateOnly(startDate),
        endDate: toUtcDateOnly(endDate),
        weeklyFrequency,
        targetDistance: targetDistance,
        targetDate: effectiveTargetDate !== null ? toUtcDateOnly(effectiveTargetDate) : null,
        baselineWeeklyKm: baseline.weeklyKm,
        baselineAcwr: baseline.acwr,
        lthrPaceUsed,
        status: "active",
      },
    });

    await tx.trainingWorkout.createMany({
      data: workouts.map((w) => ({
        planId: plan.id,
        date: toUtcDateOnly(w.date),
        weekNumber: w.weekNumber,
        dayIndex: w.dayIndex,
        type: w.type,
        distanceKm: w.distanceKm,
        paceSecPerKm: w.paceSecPerKm,
        zone: w.zone,
        intervalDesc: w.intervalDesc,
        notes: w.notes,
      })),
    });

    return { plan, archivedPreviousPlanIds: archivedActive.map((p) => p.id) };
  });

  const byWeek = [1, 2, 3, 4].map((wk) => {
    const list = workouts.filter((w) => w.weekNumber === wk);
    const totalKm =
      Math.round(list.reduce((sum, w) => sum + (w.distanceKm ?? 0), 0) * 10) / 10;
    return {
      week: wk,
      totalKm,
      workouts: list.filter((w) => w.type !== "rest").map(summarizeWorkout),
    };
  });

  const payload = {
    planId: result.plan.id,
    startDate: ymdKST(startDate),
    endDate: ymdKST(endDate),
    weeklyFrequency,
    targetDistance: targetDistance ?? undefined,
    targetDate: effectiveTargetDate !== null ? ymdKST(effectiveTargetDate) : undefined,
    baselineWeeklyKm: baseline.weeklyKm,
    baselineAcwr: baseline.acwr ?? undefined,
    lthrPaceUsed: result.plan.lthrPaceUsed !== null ? Math.round(result.plan.lthrPaceUsed) : undefined,
    weeks: byWeek,
    archivedPreviousPlanIds:
      result.archivedPreviousPlanIds.length > 0
        ? result.archivedPreviousPlanIds
        : undefined,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

interface WorkoutStatusRow {
  date: string;
  type: string;
  distanceKm: number | null;
  pace: string | null;
  zone: string | null;
  status: "completed" | "missed" | "pending";
  matched?: { distanceKm: number; actualPace: string | null };
}

export async function getActiveTrainingPlan() {
  const plan = await prisma.trainingPlan.findFirst({
    where: { status: "active" },
    orderBy: { createdAt: "desc" },
    include: {
      workouts: {
        orderBy: { date: "asc" },
      },
    },
  });

  if (!plan) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ plan: null }) }],
    };
  }

  // 진행 파생: plan 기간의 러닝 activity 를 KST day 기준으로 그룹.
  const planStart = plan.startDate;
  const planEnd = new Date(plan.endDate.getTime() + DAY_MS); // exclusive
  const activities = await prisma.activity.findMany({
    where: {
      startTime: { gte: planStart, lt: planEnd },
      activityType: { contains: "running" },
      distance: { not: null },
    },
    select: { startTime: true, distance: true, avgPace: true },
    orderBy: { startTime: "asc" },
  });

  const byDate = new Map<
    string,
    { distanceKm: number; avgPace: number | null }[]
  >();
  for (const a of activities) {
    const key = ymdKST(a.startTime);
    const entry = { distanceKm: (a.distance ?? 0) / 1000, avgPace: a.avgPace };
    const list = byDate.get(key);
    if (list) list.push(entry);
    else byDate.set(key, [entry]);
  }

  const todayStr = todayKSTString();
  const rows: WorkoutStatusRow[] = [];
  let completed = 0;
  let missed = 0;
  let pending = 0;
  let todayWorkout: WorkoutStatusRow | undefined;

  for (const w of plan.workouts) {
    const dateStr = ymdKST(w.date);
    const row: WorkoutStatusRow = {
      date: dateStr,
      type: w.type,
      distanceKm: w.distanceKm,
      pace: w.paceSecPerKm !== null ? formatPace(w.paceSecPerKm) : null,
      zone: w.zone,
      status: "pending",
    };

    if (w.type === "rest") {
      // rest 는 무조건 pending 대신 별도 표기하지 않고 skip (요약에서 제외)
      // 진행률 계산에서 rest 제외 → 요약 카운터에는 반영 X
    } else if (dateStr > todayStr) {
      pending++;
      row.status = "pending";
    } else {
      const matches = byDate.get(dateStr) ?? [];
      const plannedKm = w.distanceKm ?? 0;
      const threshold = plannedKm * 0.9;
      // 계획 이상 거리 우선, 없으면 가장 긴 것.
      const sufficient = matches.filter((m) => m.distanceKm >= threshold);
      const pick =
        sufficient.length > 0
          ? sufficient.reduce((a, b) => (a.distanceKm >= b.distanceKm ? a : b))
          : null;
      if (pick) {
        completed++;
        row.status = "completed";
        row.matched = {
          distanceKm: Math.round(pick.distanceKm * 100) / 100,
          actualPace: pick.avgPace !== null ? formatPace(pick.avgPace) : null,
        };
      } else {
        missed++;
        row.status = "missed";
      }
    }

    if (dateStr === todayStr) {
      todayWorkout = row;
    }
    rows.push(row);
  }

  const totalActive = completed + missed + pending;
  const completionPct =
    totalActive > 0 ? Math.round((completed / totalActive) * 1000) / 10 : 0;

  const payload = {
    plan: {
      planId: plan.id,
      startDate: ymdKST(plan.startDate),
      endDate: ymdKST(plan.endDate),
      weeklyFrequency: plan.weeklyFrequency,
      targetDistance: plan.targetDistance ?? undefined,
      targetDate: plan.targetDate !== null ? ymdKST(plan.targetDate) : undefined,
    },
    progress: { total: totalActive, completed, missed, pending, completionPct },
    todayWorkout,
    workouts: rows,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}
