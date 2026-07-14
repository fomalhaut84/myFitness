// M6-1: weeklyFrequency 별 요일 패턴 (Mon = 0 ~ Sun = 6).
// 각 workout 은 주간 총 볼륨 대비 비율(volumeRatio, 0 ~ 1) 로 표기.
// rest 일은 이 목록에 포함되지 않음 (호출자가 빈 칸을 rest 로 처리).

export type WorkoutType =
  | "easy"
  | "long"
  | "tempo"
  | "interval"
  | "recovery"
  | "rest";

export interface WeeklySlot {
  dayIndex: number; // 0 = Mon, 6 = Sun
  type: WorkoutType;
  volumeRatio: number; // 주간 총 km 대비 비율
}

const PATTERN_3X: WeeklySlot[] = [
  { dayIndex: 1, type: "easy", volumeRatio: 0.2 },   // Tue
  { dayIndex: 3, type: "tempo", volumeRatio: 0.2 },  // Thu
  { dayIndex: 5, type: "long", volumeRatio: 0.35 },  // Sat
];

const PATTERN_4X: WeeklySlot[] = [
  { dayIndex: 1, type: "easy", volumeRatio: 0.2 },   // Tue
  { dayIndex: 2, type: "easy", volumeRatio: 0.15 },  // Wed
  { dayIndex: 3, type: "tempo", volumeRatio: 0.2 },  // Thu
  { dayIndex: 5, type: "long", volumeRatio: 0.35 },  // Sat
];

const PATTERN_5X: WeeklySlot[] = [
  { dayIndex: 0, type: "easy", volumeRatio: 0.15 },     // Mon
  { dayIndex: 1, type: "interval", volumeRatio: 0.15 }, // Tue
  { dayIndex: 2, type: "easy", volumeRatio: 0.15 },     // Wed
  { dayIndex: 3, type: "tempo", volumeRatio: 0.15 },    // Thu
  { dayIndex: 5, type: "long", volumeRatio: 0.30 },     // Sat
];

export function patternFor(weeklyFrequency: number): WeeklySlot[] {
  if (weeklyFrequency <= 3) return PATTERN_3X;
  if (weeklyFrequency === 4) return PATTERN_4X;
  return PATTERN_5X;
}

/** 패턴 volumeRatio 합. 생성기가 baseline × weekMult 를 곱할 때 정규화에 사용. */
export function patternRatioSum(pattern: WeeklySlot[]): number {
  return pattern.reduce((sum, s) => sum + s.volumeRatio, 0);
}

// M11 Phase 1 (#222): 주차별 주간 볼륨 배율은 weekly-progression.ts 의
// computeWeeklyProgression(weekCount) 로 이동. weekCount 별로 다르므로 정적 상수 제거.
