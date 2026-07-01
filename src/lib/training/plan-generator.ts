// M6-1: 4주 트레이닝 플랜 결정적 생성.
// 입력: baseline 주간 km + LTHR pace + weeklyFrequency + optional race target
// 출력: 28일치 workout skeleton (rest 포함)

import { patternFor, WEEKLY_MULTIPLIERS, type WorkoutType } from "./workout-patterns";
import { paceZoneFor, pseudoLthrPace } from "./pace-calc";

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
    (recentAvgPaceSecPerKm ? pseudoLthrPace(recentAvgPaceSecPerKm) : 360); // 최후 fallback 6:00 pace
  const pattern = patternFor(weeklyFrequency);

  const workouts: GeneratedWorkout[] = [];

  for (let week = 0; week < 4; week++) {
    const weekMult = WEEKLY_MULTIPLIERS[week];
    const weekBaseKm = baselineWeeklyKm * weekMult;

    // Wk4 race taper: targetDate 가 이 주 내에 있으면 볼륨 배율 재계산 (선형 감소).
    const weekStart = addDays(startDate, week * 7);
    const weekEnd = addDays(weekStart, 6);
    const isRaceWeek =
      week === 3 &&
      targetDate !== null &&
      targetDate >= weekStart &&
      targetDate <= weekEnd;

    for (let d = 0; d < 7; d++) {
      const date = addDays(weekStart, d);
      const dayIdx = mondayZeroDayIndex(date);
      const slot = pattern.find((s) => s.dayIndex === dayIdx);

      // race 당일이면 무조건 rest (강제 taper).
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

      let workoutKm = weekBaseKm * slot.volumeRatio;

      // Race week 이면 targetDate 이후 workout 제거 (rest 처리) + 이전 workout 볼륨 60% 축소.
      if (isRaceWeek && targetDate) {
        if (date > targetDate) {
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
        workoutKm *= 0.6; // taper
      }

      const pz = paceZoneFor(slot.type, lthrPace);
      workouts.push({
        date,
        weekNumber: week + 1,
        dayIndex: dayIdx,
        type: slot.type,
        distanceKm: Math.round(workoutKm * 10) / 10, // 소수점 1
        paceSecPerKm: pz?.paceSecPerKm ?? null,
        zone: pz?.zone ?? null,
        intervalDesc:
          slot.type === "interval"
            ? `6x400m Z5 (jog 200m recovery)`
            : null,
        notes: notesFor(slot.type),
      });
    }
  }

  return workouts;
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
