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
import {
  validateTimeGoal,
  validateEnduranceGoal,
  validateWeightLossGoal,
  type EnduranceGoalValue,
  type GoalType,
  type IntensityMode,
  type TimeGoalValue,
  type WeightLossGoalValue,
} from "../../lib/training/goal-progression";

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_PLAN_LOCK_KEY = 761101; // pg_advisory_xact_lock 키 (임의 상수)
const TARGET_DISTANCES = ["5K", "10K", "HM", "FM"] as const;
type TargetDistance = (typeof TARGET_DISTANCES)[number];

// M11 Phase 1 (#222): weekCount 유효 범위. 하한 4 (기존 최소 케이스),
// 상한 24 (Marathon prep 통상 최대 - 진행 정확도/사용성 균형).
const WEEK_COUNT_MIN = 4;
const WEEK_COUNT_MAX = 24;
const WEEK_COUNT_DEFAULT = 4;

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
  weekCount?: number; // M11 Phase 1: 4 ~ 24
  // M11 Phase 2: 목표 유형 + 페이로드. 미지정 시 "distance" (기존 동작).
  goalType?: GoalType;
  // goalType == "distance" 시 사용 (레거시 호환).
  targetDistance?: string;
  targetDate?: string; // "YYYY-MM-DD"
  // goalType == "time" 시 사용.
  timeGoal?: {
    distance?: string;
    targetTimeSec?: number;
    targetDate?: string;
  };
  // goalType == "endurance" 시 사용.
  enduranceGoal?: {
    targetLongRunKm?: number;
    targetDate?: string;
  };
  // goalType == "weight_loss" 시 사용 (M11 Phase 2-b #236).
  weightLossGoal?: {
    intensityMode?: string;
  };
}

const GOAL_TYPES: readonly GoalType[] = [
  "distance",
  "time",
  "endurance",
  "weight_loss",
];

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

  // M11 Phase 1: weekCount validate (4~24, 정수, 기본 4).
  const rawWeekCount = input.weekCount ?? WEEK_COUNT_DEFAULT;
  if (!Number.isFinite(rawWeekCount)) {
    throw new Error(`유효하지 않은 weekCount: ${input.weekCount} (정수 4~24 필요)`);
  }
  const weekCount = Math.round(rawWeekCount);
  if (weekCount < WEEK_COUNT_MIN || weekCount > WEEK_COUNT_MAX) {
    throw new Error(
      `weekCount 는 ${WEEK_COUNT_MIN} ~ ${WEEK_COUNT_MAX} 범위여야 합니다. 현재 값: ${input.weekCount}`
    );
  }

  // M11 Phase 2: goalType 처리.
  const goalType: GoalType =
    input.goalType !== undefined ? input.goalType : "distance";
  if (!GOAL_TYPES.includes(goalType)) {
    throw new Error(
      `goalType 은 ${GOAL_TYPES.join("/")} 중 하나여야 합니다. 현재: ${input.goalType}`,
    );
  }

  // goalType 별 페이로드 검증 + targetDate 정규화. targetDate 는 유형별로 다른 필드에서 오지만
  // Wk4 창 검증은 공통 로직 (기존 finalWeekStart 규칙) 이라 하나로 통합.
  let timeGoal: TimeGoalValue | undefined;
  let enduranceGoal: EnduranceGoalValue | undefined;
  let weightLossGoal: WeightLossGoalValue | undefined;
  let unifiedTargetDateStr: string | undefined;
  let unifiedTargetDistance: TargetDistance | null = targetDistance;

  if (goalType === "distance") {
    unifiedTargetDateStr = input.targetDate;
  } else if (goalType === "time") {
    const raw = input.timeGoal;
    if (!raw) {
      throw new Error("time 목표는 timeGoal 페이로드가 필요합니다.");
    }
    const dist = validateTargetDistance(raw.distance);
    if (dist === null) {
      throw new Error(
        `time 목표 distance 는 5K/10K/HM/FM 중 하나여야 합니다. 현재: ${raw.distance}`,
      );
    }
    if (raw.targetTimeSec === undefined || raw.targetDate === undefined) {
      throw new Error("time 목표는 targetTimeSec + targetDate 필드가 필수입니다.");
    }
    const candidate: TimeGoalValue = {
      distance: dist,
      targetTimeSec: raw.targetTimeSec,
      targetDate: raw.targetDate,
    };
    const err = validateTimeGoal(candidate);
    if (err !== null) throw new Error(err);
    timeGoal = candidate;
    unifiedTargetDateStr = candidate.targetDate;
    unifiedTargetDistance = dist;
  } else if (goalType === "endurance") {
    const raw = input.enduranceGoal;
    if (!raw || raw.targetLongRunKm === undefined) {
      throw new Error("endurance 목표는 enduranceGoal.targetLongRunKm 이 필수입니다.");
    }
    const candidate: EnduranceGoalValue = {
      targetLongRunKm: raw.targetLongRunKm,
      targetDate: raw.targetDate,
    };
    const err = validateEnduranceGoal(candidate);
    if (err !== null) throw new Error(err);
    enduranceGoal = candidate;
    unifiedTargetDateStr = candidate.targetDate;
  } else {
    // weight_loss — UserProfile targetWeight 재사용, goalValue 는 intensityMode 만.
    const raw = input.weightLossGoal;
    if (!raw || raw.intensityMode === undefined) {
      throw new Error(
        "weight_loss 목표는 weightLossGoal.intensityMode 가 필수입니다 (light/standard/intense).",
      );
    }
    const candidate: WeightLossGoalValue = {
      intensityMode: raw.intensityMode as IntensityMode,
    };
    const err = validateWeightLossGoal(candidate);
    if (err !== null) throw new Error(err);
    // UserProfile.targetWeight pre-check (감량 목표 → 목표 체중 필수).
    const wlProfile = await prisma.userProfile.findFirst({
      select: { targetWeight: true },
    });
    if (wlProfile?.targetWeight === null || wlProfile?.targetWeight === undefined) {
      throw new Error(
        "weight_loss 목표는 UserProfile.targetWeight 가 먼저 설정되어야 합니다. /settings/profile 에서 지정하세요.",
      );
    }
    weightLossGoal = candidate;
    // targetDate 는 별도 지정 안 함 (UserProfile.targetDate 참조는 향후 옵션).
  }

  const targetDate =
    unifiedTargetDateStr !== undefined ? parseKstDate(unifiedTargetDateStr) : null;
  if (unifiedTargetDateStr !== undefined && targetDate === null) {
    throw new Error(`유효하지 않은 targetDate: ${unifiedTargetDateStr} (YYYY-MM-DD 형식 필요)`);
  }
  if (goalType === "distance" && targetDate !== null && unifiedTargetDistance === null) {
    throw new Error("targetDate 를 지정하려면 targetDistance 도 함께 지정해야 합니다.");
  }

  // 프로필 + baseline
  const profile = await prisma.userProfile.findFirst({
    select: { lthrPace: true },
  });
  const lthrPace = profile?.lthrPace ?? null;
  const baseline = await computeBaseline();

  // M8: 목표 거리에 맞춰 baseline 스케일 (히스토리 sanity cap 포함).
  // M11 Phase 2: time 목표는 unifiedTargetDistance (timeGoal.distance) 로 스케일. endurance 는
  // 사용자 지정 targetLongRunKm 이 우선이라 distance 배율 미적용 (null 로 skip).
  // M11 Phase 2-b: weight_loss 도 스케일 skip (감량 중 무리한 볼륨 확장 방지).
  const scaleTargetDistance: ScaleTarget | null =
    goalType === "endurance" || goalType === "weight_loss"
      ? null
      : (unifiedTargetDistance as ScaleTarget | null);
  const scaled = scaleBaseline(
    baseline.weeklyKm,
    scaleTargetDistance,
    baseline.historicalMaxWeekKm
  );

  const startDate = new Date(todayKST().getTime() + DAY_MS); // 내일
  // M11 Phase 1: 기간 커스텀. endDate = startDate + (weekCount*7 - 1)일.
  const totalDays = weekCount * 7;
  const endDate = new Date(startDate.getTime() + (totalDays - 1) * DAY_MS);
  const finalWeekStart = new Date(
    startDate.getTime() + (weekCount - 1) * 7 * DAY_MS
  );

  // targetDate 는 마지막 주 창 [finalWeekStart ~ endDate] 내에 있어야 tapering 이 의미 있음.
  // 그 외 시점(과거, 너무 가까움, plan 창 밖) 은 mutation 전에 명시적으로 거부.
  // (silent null 대체 시 사용자의 active plan 이 archived 되고 race 요청이 무시된 plan 이 저장됨)
  if (targetDate !== null && (targetDate < finalWeekStart || targetDate > endDate)) {
    const finalStartStr = ymdKST(finalWeekStart);
    const endStr = ymdKST(endDate);
    throw new Error(
      `targetDate 는 마지막 주 창 [${finalStartStr} ~ ${endStr}] 내에 있어야 합니다. ` +
        `현재 값: ${unifiedTargetDateStr}. 더 가까운 race 는 별도 대응 필요.`
    );
  }
  const effectiveTargetDate = targetDate;

  const workouts = generatePlan({
    startDate,
    weekCount,
    weeklyFrequency,
    baselineWeeklyKm: scaled.finalBase,
    lthrPaceSecPerKm: lthrPace,
    recentAvgPaceSecPerKm: baseline.recentAvgPace,
    // distance/time: unifiedTargetDistance (5K/10K/HM/FM). endurance/weight_loss: null.
    targetDistance:
      goalType === "endurance" || goalType === "weight_loss"
        ? null
        : unifiedTargetDistance,
    targetDate: effectiveTargetDate,
    goalType,
    timeGoal,
    enduranceGoal,
    weightLossGoal,
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

    // M11 Phase 2: goalValue 는 유형별 페이로드 (distance 는 undefined → null 저장).
    // Prisma Json 필드 입력은 InputJsonValue 타입이라 좁게 캐스팅.
    const goalValueForDb =
      goalType === "time" && timeGoal !== undefined
        ? {
            distance: timeGoal.distance,
            targetTimeSec: timeGoal.targetTimeSec,
            targetDate: timeGoal.targetDate,
          }
        : goalType === "endurance" && enduranceGoal !== undefined
          ? {
              targetLongRunKm: enduranceGoal.targetLongRunKm,
              targetDate: enduranceGoal.targetDate ?? null,
            }
          : goalType === "weight_loss" && weightLossGoal !== undefined
            ? { intensityMode: weightLossGoal.intensityMode }
            : undefined;

    const plan = await tx.trainingPlan.create({
      data: {
        startDate: toUtcDateOnly(startDate),
        endDate: toUtcDateOnly(endDate),
        weekCount,
        weeklyFrequency,
        goalType,
        goalValue: goalValueForDb,
        // targetDistance 는 distance/time 유형에서만 채움. endurance/weight_loss 는 null.
        targetDistance:
          goalType === "endurance" || goalType === "weight_loss"
            ? null
            : unifiedTargetDistance,
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

  const byWeek = Array.from({ length: weekCount }, (_, i) => i + 1).map((wk) => {
    const list = workouts.filter((w) => w.weekNumber === wk);
    const totalKm =
      Math.round(list.reduce((sum, w) => sum + (w.distanceKm ?? 0), 0) * 10) / 10;
    return {
      week: wk,
      totalKm,
      workouts: list.filter((w) => w.type !== "rest").map(summarizeWorkout),
    };
  });

  const goalValueForPayload =
    goalType === "time" && timeGoal !== undefined
      ? { ...timeGoal }
      : goalType === "endurance" && enduranceGoal !== undefined
        ? { ...enduranceGoal }
        : goalType === "weight_loss" && weightLossGoal !== undefined
          ? { ...weightLossGoal }
          : undefined;

  const payload = {
    planId: result.plan.id,
    startDate: ymdKST(startDate),
    endDate: ymdKST(endDate),
    weekCount,
    weeklyFrequency,
    goalType,
    goalValue: goalValueForPayload,
    targetDistance:
      goalType === "endurance" || goalType === "weight_loss"
        ? undefined
        : unifiedTargetDistance ?? undefined,
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
  // M13 Phase 2 (#249): TrainingWorkout.autoAdjusted flag 노출 (notes prefix 파생은 사용자
  // 편집으로 무너져 authoritative 아님, PR #250 P1).
  autoAdjusted?: boolean;
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
      autoAdjusted: w.autoAdjusted,
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
      weekCount: plan.weekCount,
      weeklyFrequency: plan.weeklyFrequency,
      goalType: plan.goalType,
      goalValue: plan.goalValue ?? undefined,
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
