// M6-1: 4주 트레이닝 플랜 결정적 생성.
// 입력: baseline 주간 km + LTHR pace + weeklyFrequency + optional race target
// 출력: 28일치 workout skeleton (rest 포함)

import {
  patternFor,
  patternRatioSum,
  WEEKLY_MULTIPLIERS,
  type WorkoutType,
} from "./workout-patterns";
import { paceZoneFor, pseudoLthrPace } from "./pace-calc";
import {
  PEAK_LONG_MIN_KM,
  type TargetDistance,
} from "./plan-scaling";

export interface GeneratedWorkout {
  date: Date; // KST 00:00 timestamp
  weekNumber: number; // 1 ~ 4
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
  weeklyFrequency: number; // 3 | 4 | 5
  baselineWeeklyKm: number;
  lthrPaceSecPerKm: number | null; // 없으면 pseudo 계산 필요 → 호출자가 넘김
  recentAvgPaceSecPerKm: number | null; // pseudo 대체
  targetDistance: string | null;
  targetDate: Date | null;
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
 * 4주 플랜 생성.
 * 각 주는 startDate 기준 7일씩 슬라이스. dayIndex 는 실제 요일에 맞춰 매칭.
 * race taper: targetDate 가 마지막 주 내에 있으면 Wk4 볼륨을 targetDate 까지 선형 감소, race 당일 rest.
 */
export function generatePlan(input: PlanGeneratorInput): GeneratedWorkout[] {
  const {
    startDate,
    weeklyFrequency,
    baselineWeeklyKm,
    lthrPaceSecPerKm,
    recentAvgPaceSecPerKm,
    targetDate,
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

  const workouts: GeneratedWorkout[] = [];
  const RACE_TAPER_WINDOW_DAYS = 6; // race day 기준 이전 6일이 pre-race taper 구간.

  // race day 기준 pre-taper window [targetDate - 6..targetDate - 1] 내에 있는
  // workout slot 을 전체 4주 범위에서 시간순으로 수집하고 선형 factor (0.6 → ~0) 매핑.
  // 이렇게 하면 startDate 요일과 race 요일 misalignment (예: Wk3 마지막 주말이 race 전 2일)
  // 상황에서도 실제 race 직전 workout 이 taper 대상이 됨.
  const raceTaperFactorByTime = new Map<number, number>();
  if (targetDate !== null) {
    const taperStart = addDays(targetDate, -RACE_TAPER_WINDOW_DAYS);
    const preRaceDates: Date[] = [];
    for (let offset = 0; offset < 28; offset++) {
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

  for (let week = 0; week < 4; week++) {
    const weekMult = WEEKLY_MULTIPLIERS[week];
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

      // M8: Wk3 (peak) long run 은 목표별 최소 거리 보장. taper 창에 있으면 무시 (taper 우선).
      if (
        slot.type === "long" &&
        week === 2 &&
        raceTaperFactor === undefined &&
        input.targetDistance !== null &&
        input.targetDistance in PEAK_LONG_MIN_KM
      ) {
        const min = PEAK_LONG_MIN_KM[input.targetDistance as TargetDistance];
        if (workoutKm < min) workoutKm = min;
      }

      const pz = paceZoneFor(slot.type, lthrPace);
      const distanceKm = Math.round(workoutKm * 10) / 10;
      workouts.push({
        date,
        weekNumber: week + 1,
        dayIndex: dayIdx,
        type: slot.type,
        distanceKm,
        paceSecPerKm: pz?.paceSecPerKm ?? null,
        zone: pz?.zone ?? null,
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
