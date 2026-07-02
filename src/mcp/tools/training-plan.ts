// M6-1: generate_training_plan + get_active_training_plan MCP 도구.

import prisma from "../prisma";
import { todayKST, todayKSTString, ymdKST } from "../../lib/garmin/utils";
import { formatPace } from "./running-buckets";
import {
  generatePlan,
  DEFAULT_FALLBACK_LTHR_PACE_SEC_PER_KM,
  type GeneratedWorkout,
} from "../../lib/training/plan-generator";
import { pseudoLthrPace } from "../../lib/training/pace-calc";
import { computeBaseline } from "../../lib/training/baseline";
import { scaleBaseline, type TargetDistance as ScaleTarget } from "../../lib/training/plan-scaling";

const DAY_MS = 24 * 60 * 60 * 1000;
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

/** DB DATE 값을 해당 KST 벽시계 날짜의 시작 instant 로 변환. */
function dateOnlyToKstStart(dateOnly: Date): Date {
  return new Date(`${ymdKST(dateOnly)}T00:00:00+09:00`);
}

interface GenerateInput {
  weeklyFrequency?: number;
  targetDistance?: string;
  targetDate?: string; // "YYYY-MM-DD"
}

/**
 * KST 자정 Date 로 변환. 유효하지 않으면 null.
 * `2026-02-30` 같은 규정상 불가능 날짜는 `new Date` 가 3월 1일로 정규화하므로,
 * 파싱 후 KST 벽시계 문자열을 원본과 비교해 round-trip 검증.
 */
function parseKstDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return null;
  if (ymdKST(d) !== s) return null;
  return d;
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

  // M8: 목표 거리에 맞춰 baseline 스케일 (히스토리 sanity cap 포함).
  const scaled = scaleBaseline(
    baseline.weeklyKm,
    targetDistance as ScaleTarget | null,
    baseline.historicalMaxWeekKm
  );

  const startDate = new Date(todayKST().getTime() + DAY_MS); // 내일
  const endDate = new Date(startDate.getTime() + 27 * DAY_MS);
  const week4Start = new Date(startDate.getTime() + 21 * DAY_MS);

  // targetDate 는 Wk4 창(21~27일차) 내에 있어야 tapering 이 의미 있음.
  // 그 외 시점(과거, 너무 가까움, plan 창 밖) 은 mutation 전에 명시적으로 거부.
  // (silent null 대체 시 사용자의 active plan 이 archived 되고 race 요청이 무시된 plan 이 저장됨)
  if (targetDate !== null && (targetDate < week4Start || targetDate > endDate)) {
    const wk4StartStr = ymdKST(week4Start);
    const endStr = ymdKST(endDate);
    throw new Error(
      `targetDate 는 Wk4 창 [${wk4StartStr} ~ ${endStr}] 내에 있어야 합니다. ` +
        `현재 값: ${input.targetDate}. 더 가까운 race 는 별도 대응 필요.`
    );
  }
  const effectiveTargetDate = targetDate;

  const workouts = generatePlan({
    startDate,
    weeklyFrequency,
    baselineWeeklyKm: scaled.finalBase,
    lthrPaceSecPerKm: lthrPace,
    recentAvgPaceSecPerKm: baseline.recentAvgPace,
    targetDistance,
    targetDate: effectiveTargetDate,
  });

  // generatePlan 의 lthrPace 결정 로직과 정확히 일치시켜 DB 헤더와 실제 workout pace 가 정합.
  // 배율 상수가 pseudoLthrPace 한 곳에 있으므로 caller 도 동일 helper 를 사용.
  const lthrPaceUsed =
    lthrPace ??
    (baseline.recentAvgPace !== null
      ? pseudoLthrPace(baseline.recentAvgPace)
      : DEFAULT_FALLBACK_LTHR_PACE_SEC_PER_KM);

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
        // M8: DB 저장 baselineWeeklyKm 은 최종 스케일된 값 (실제 생성에 사용된 값과 일치).
        baselineWeeklyKm: scaled.finalBase,
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
    baselineWeeklyKm: scaled.finalBase,
    scaledForTarget: scaled.scaledForTarget,
    rawBaselineWeeklyKm: scaled.rawBaseline,
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
  status: "completed" | "missed" | "pending" | "rest";
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
  const planStart = dateOnlyToKstStart(plan.startDate);
  const planEnd = new Date(dateOnlyToKstStart(plan.endDate).getTime() + DAY_MS); // exclusive
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
      // rest 는 진행률 카운터에 포함하지 않음. status 는 초기값 "pending" 대신
      // 명시적으로 "rest" 로 표기하여 클라이언트/AI 가 오늘/과거 rest 를
      // pending 으로 오독하지 않도록 함.
      row.status = "rest";
    } else if (dateStr > todayStr) {
      pending++;
      row.status = "pending";
    } else {
      const matches = byDate.get(dateStr) ?? [];
      const plannedKm = w.distanceKm ?? 0;
      const threshold = plannedKm * 0.9;
      // 임계(계획 90%) 이상 활동 중 가장 긴 것 우선. 임계 미달만 있으면 missed 처리.
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
