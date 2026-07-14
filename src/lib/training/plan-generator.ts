// M6-1: 트레이닝 플랜 결정적 생성. M11 Phase 1 (#222): weekCount 4~24 지원.
// M11 Phase 2 (#232): goalType 도입 — "distance"(기존) / "time"(기록) / "endurance"(지속력).
// 입력: baseline 주간 km + LTHR pace + weeklyFrequency + weekCount + goal 정보
// 출력: weekCount*7 일치 workout skeleton (rest 포함)

import {
  patternFor,
  patternRatioSum,
  type WorkoutType,
} from "./workout-patterns";
import { paceZoneFor, pseudoLthrPace } from "./pace-calc";
import {
  PEAK_LONG_MIN_KM,
  type TargetDistance,
} from "./plan-scaling";
import { computeWeeklyProgression } from "./weekly-progression";
import {
  TIME_GOAL_DISTANCE_M,
  longRunKmForWeek,
  targetPaceForWeek,
  type EnduranceGoalValue,
  type GoalType,
  type TimeGoalValue,
} from "./goal-progression";

export interface GeneratedWorkout {
  date: Date; // KST 00:00 timestamp
  weekNumber: number; // 1 ~ weekCount
  dayIndex: number; // 0 (Mon) ~ 6 (Sun)
  type: WorkoutType;
  distanceKm: number | null;
  paceSecPerKm: number | null;
  zone: string | null;
  intervalDesc: string | null;
  notes: string | null;
}

/** LTHR pace 도 avgPace 도 없을 때 최종 fallback (6:00/km). generatePlan 내부와 caller 저장 로직이 반드시 동일 값을 사용해야 함. */
export const DEFAULT_FALLBACK_LTHR_PACE_SEC_PER_KM = 360;

export interface PlanGeneratorInput {
  startDate: Date; // 내일 KST 00:00 timestamp (Mon-Sun 이어야 함은 X, 요일 shift 자동 처리)
  weekCount: number; // M11 Phase 1: 4 ~ 24
  weeklyFrequency: number; // 3 | 4 | 5
  baselineWeeklyKm: number;
  lthrPaceSecPerKm: number | null; // 없으면 pseudo 계산 필요 → 호출자가 넘김
  recentAvgPaceSecPerKm: number | null; // pseudo 대체
  targetDistance: string | null;
  targetDate: Date | null;
  // M11 Phase 2: 목표 유형. 미지정 시 "distance" (기존 동작).
  goalType?: GoalType;
  timeGoal?: TimeGoalValue;
  enduranceGoal?: EnduranceGoalValue;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Date 에 하루씩 더한 새 Date (immutable). */
function addDays(base: Date, n: number): Date {
  return new Date(base.getTime() + n * DAY_MS);
}

/** 0 = Mon, 6 = Sun. JavaScript getUTCDay() 는 0 = Sun 이므로 shift. */
function mondayZeroDayIndex(date: Date): number {
  // KST 기준 dayIndex 를 원함. date 는 KST 00:00 timestamp (UTC 표현).
  // UTC 상으로 15:00 (전날). getUTCDay() 는 UTC 요일 기준. 그러나 KST 00:00 = UTC 전날 15:00.
  // KST 요일 = UTC 요일 (0시 이후는 다음날) — 그러나 KST 00:00 은 UTC 전날. 결국 KST 요일과 UTC 요일이 다름.
  // 정공법: KST timestamp 를 다시 KST 로 변환 후 요일 뽑기. 여기서는 UTC+9 로 shift.
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const utcSunZero = kst.getUTCDay(); // 0 = Sun
  return (utcSunZero + 6) % 7; // 0 = Mon
}

/**
 * 트레이닝 플랜 생성 (기간 weekCount 주 자유 지정).
 * 각 주는 startDate 기준 7일씩 슬라이스. dayIndex 는 실제 요일에 맞춰 매칭.
 * race taper: targetDate 가 마지막 주 창 내에 있으면 볼륨을 targetDate 까지 선형 감소, race 당일 rest.
 */
export function generatePlan(input: PlanGeneratorInput): GeneratedWorkout[] {
  const {
    startDate,
    weekCount,
    weeklyFrequency,
    baselineWeeklyKm,
    lthrPaceSecPerKm,
    recentAvgPaceSecPerKm,
    targetDate,
    goalType = "distance",
    timeGoal,
    enduranceGoal,
  } = input;

  const lthrPace =
    lthrPaceSecPerKm ??
    (recentAvgPaceSecPerKm
      ? pseudoLthrPace(recentAvgPaceSecPerKm)
      : DEFAULT_FALLBACK_LTHR_PACE_SEC_PER_KM);
  const pattern = patternFor(weeklyFrequency);
  // volumeRatio 합이 1 이 아니어도 (예: 3x = 0.75, 4x/5x = 0.90) 정규화하여
  // Wk1 = baseline × weekMult 를 만족시킴. 슬롯간 상대 비중은 유지.
  const patternSum = patternRatioSum(pattern);
  const ratioNorm = patternSum > 0 ? 1 / patternSum : 1;

  const progression = computeWeeklyProgression(weekCount);
  const totalDays = weekCount * 7;

  // M11 Phase 2: goal 유형별 pre-compute.
  // time 목표: target pace (sec/km) = targetTimeSec / distanceKm. tempo/interval slot 에 적용.
  const timeTargetPace =
    goalType === "time" && timeGoal !== undefined
      ? timeGoal.targetTimeSec /
        (TIME_GOAL_DISTANCE_M[timeGoal.distance] / 1000)
      : null;
  const growthWeeks = progression.peakWeekIdx + 1; // peak 주 포함한 growth 주 수.
  // endurance 목표: Wk1 (week=0) 의 long slot 기본 거리 = baseline × Wk1 weekMult × long ratio.
  // multipliers[0] = 1.0 (또는 buildup end) 이므로 baseline × normalizedRatio 로 계산.
  const longSlotRatio = pattern.find((s) => s.type === "long");
  const baselineLongKm =
    goalType === "endurance" && longSlotRatio !== undefined
      ? baselineWeeklyKm *
        progression.multipliers[0] *
        (longSlotRatio.volumeRatio * ratioNorm)
      : 0;

  const workouts: GeneratedWorkout[] = [];
  const RACE_TAPER_WINDOW_DAYS = 6; // race day 기준 이전 6일이 pre-race taper 구간.

  // race day 기준 pre-taper window [targetDate - 6..targetDate - 1] 내에 있는
  // workout slot 을 전체 플랜 범위에서 시간순으로 수집하고 선형 factor (0.6 → ~0) 매핑.
  // startDate 요일과 race 요일 misalignment 상황에서도 실제 race 직전 workout 이 taper 대상이 됨.
  const raceTaperFactorByTime = new Map<number, number>();
  if (targetDate !== null) {
    const taperStart = addDays(targetDate, -RACE_TAPER_WINDOW_DAYS);
    const preRaceDates: Date[] = [];
    for (let offset = 0; offset < totalDays; offset++) {
      const date = addDays(startDate, offset);
      if (date < taperStart || date >= targetDate) continue;
      const dayIdx = mondayZeroDayIndex(date);
      const slot = pattern.find((s) => s.dayIndex === dayIdx);
      if (slot) preRaceDates.push(date);
    }
    const total = preRaceDates.length;
    preRaceDates.forEach((date, i) => {
      raceTaperFactorByTime.set(
        date.getTime(),
        total > 0 ? 0.6 * ((total - i) / total) : 0
      );
    });
  }

  for (let week = 0; week < weekCount; week++) {
    const weekMult = progression.multipliers[week];
    const weekBaseKm = baselineWeeklyKm * weekMult;
    const weekStart = addDays(startDate, week * 7);

    for (let d = 0; d < 7; d++) {
      const date = addDays(weekStart, d);
      const dayIdx = mondayZeroDayIndex(date);
      const slot = pattern.find((s) => s.dayIndex === dayIdx);

      // race 당일이면 무조건 rest.
      const isRaceDay =
        targetDate !== null && date.getTime() === targetDate.getTime();

      if (isRaceDay) {
        workouts.push({
          date,
          weekNumber: week + 1,
          dayIndex: dayIdx,
          type: "rest",
          distanceKm: null,
          paceSecPerKm: null,
          zone: null,
          intervalDesc: null,
          notes: `${input.targetDistance ?? "Race"} 당일 — 완전 휴식 + race pace 유지`,
        });
        continue;
      }

      // race 후 workout 은 회복 rest.
      if (targetDate !== null && date > targetDate) {
        workouts.push({
          date,
          weekNumber: week + 1,
          dayIndex: dayIdx,
          type: "rest",
          distanceKm: null,
          paceSecPerKm: null,
          zone: null,
          intervalDesc: null,
          notes: "Race 후 회복",
        });
        continue;
      }

      if (!slot) {
        workouts.push({
          date,
          weekNumber: week + 1,
          dayIndex: dayIdx,
          type: "rest",
          distanceKm: null,
          paceSecPerKm: null,
          zone: null,
          intervalDesc: null,
          notes: "휴식",
        });
        continue;
      }

      const normalizedRatio = slot.volumeRatio * ratioNorm;
      let workoutKm = weekBaseKm * normalizedRatio;

      // race pre-taper window: 정상 배율 대신 선형 taper factor 적용.
      const raceTaperFactor = raceTaperFactorByTime.get(date.getTime());
      if (raceTaperFactor !== undefined) {
        workoutKm = baselineWeeklyKm * normalizedRatio * raceTaperFactor;
      }

      // M8 / distance / time 목표: peak 주 long run 은 race 거리별 최소 거리 보장.
      // taper 창에 있으면 무시. distance 와 time 모두 실제 race 를 뜁니다 (HM/FM 완주 지구력 필수),
      // 그래서 두 유형 다 peak long min 을 적용해야 준비 부족을 방지 (Codex P2).
      // endurance 목표는 사용자가 명시적 targetLongRunKm 을 지정하므로 이 승격 로직 skip.
      if (
        (goalType === "distance" || goalType === "time") &&
        slot.type === "long" &&
        week === progression.peakWeekIdx &&
        raceTaperFactor === undefined &&
        input.targetDistance !== null &&
        input.targetDistance in PEAK_LONG_MIN_KM
      ) {
        const min = PEAK_LONG_MIN_KM[input.targetDistance as TargetDistance];
        if (workoutKm < min) workoutKm = min;
      }

      // M11 Phase 2 endurance: long slot 은 baseline → targetLongRunKm 주차별 선형 ramp.
      // race taper 창은 원 로직 그대로 (0.6 → 0 감쇠) — 사용자 지정 target 보다 race 준비가 우선.
      if (
        goalType === "endurance" &&
        enduranceGoal !== undefined &&
        slot.type === "long" &&
        raceTaperFactor === undefined
      ) {
        // multipliers 는 growth 구간 [1.0..1.2] 와 taper [0.8] or [0.85, 0.7] 로 구성.
        // taper 주는 multipliers[week] 를 target 대비 배율로 재해석 (targetLongRunKm × factor).
        const isTaperWeek = week >= growthWeeks;
        const taperFactor = isTaperWeek
          ? progression.multipliers[week] / 1.2 // 정규화 (peak 대비 상대 배율)
          : undefined;
        workoutKm = longRunKmForWeek(
          baselineLongKm,
          enduranceGoal.targetLongRunKm,
          week,
          growthWeeks,
          taperFactor,
        );
      }

      const distanceKm = Math.round(workoutKm * 10) / 10;

      // M11 Phase 2 time: tempo/interval 페이스를 baseline → target 으로 개선.
      // 다른 slot 은 기본 zone 페이스 유지 (회복/지구력 강도 유지 → 부상 방지).
      let paceSecPerKm: number | null;
      let zone: string | null;
      if (
        goalType === "time" &&
        timeTargetPace !== null &&
        (slot.type === "tempo" || slot.type === "interval")
      ) {
        const improved = targetPaceForWeek(
          slot.type,
          recentAvgPaceSecPerKm,
          timeTargetPace,
          week,
          growthWeeks,
        );
        paceSecPerKm = improved ?? paceZoneFor(slot.type, lthrPace)?.paceSecPerKm ?? null;
        zone = paceZoneFor(slot.type, lthrPace)?.zone ?? null;
      } else {
        const pz = paceZoneFor(slot.type, lthrPace);
        paceSecPerKm = pz?.paceSecPerKm ?? null;
        zone = pz?.zone ?? null;
      }

      workouts.push({
        date,
        weekNumber: week + 1,
        dayIndex: dayIdx,
        type: slot.type,
        distanceKm,
        paceSecPerKm,
        zone,
        intervalDesc:
          slot.type === "interval" ? intervalDescFor(distanceKm) : null,
        notes: notesFor(slot.type),
      });
    }
  }

  return workouts;
}

/**
 * 인터벌 설명 생성 — reps 를 workoutKm 에 맞춰 동적으로 계산.
 * 400 m 반복 + 200 m jog 회복 = 회당 0.6 km. reps ≈ workoutKm / 0.6.
 * 3 ~ 10 회로 clamp (그 미만은 인터벌 자격 없음, 초과는 tempo 성격).
 */
function intervalDescFor(workoutKm: number): string {
  const reps = Math.max(3, Math.min(10, Math.round(workoutKm / 0.6)));
  return `${reps}x400m Z5 (jog 200m recovery)`;
}

function notesFor(type: WorkoutType): string {
  switch (type) {
    case "easy":
      return "편안하게 대화 가능한 페이스";
    case "long":
      return "긴 거리 지구력 — Z2 유지, 마지막 2km 만 약간 up 가능";
    case "tempo":
      return "임계 페이스 아래 — comfortably hard";
    case "interval":
      return "고강도 반복 — 각 인터벌은 all-out, 회복 조깅 필수";
    case "recovery":
      return "적극적 회복 — Z1 유지, 매우 느리게";
    case "rest":
      return "휴식";
  }
}
