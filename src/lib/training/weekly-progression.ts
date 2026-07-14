// M11 Phase 1 (#222): weekCount 로 정규화된 주간 volume ramp.
//
// 4주 고정이던 WEEKLY_MULTIPLIERS = [1.0, 1.1, 1.2, 0.8] 를 일반화.
//
// 구성:
//   - growth : 첫 (weekCount - taperWeeks) 주. 1.0 → 1.2 선형 램프. 마지막이 peak.
//              스펙상 "buildUp (ceil(wc*0.25))" 은 growth 의 앞부분에 해당,
//              "main load" 는 growth 의 나머지. 4주 회귀를 위해 하나의 연속 램프로 통합.
//   - taper  : 마지막 1~2 주. weekCount ≤ 8 → 1주 [0.8].
//              > 8 → 2주 [0.85, 0.7] (경기 전 감량 창).
//
// 회귀 검증:
//   weekCount=4 → growth=3 [1.0, 1.1, 1.2] + taper=[0.8] = [1.0, 1.1, 1.2, 0.8] ✓ (기존 상수 동일)

const GROWTH_START = 1.0;
const PEAK = 1.2;
const TAPER_1 = [0.8] as const;
const TAPER_2 = [0.85, 0.7] as const;

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** ramp 를 n 스텝으로 선형 분할. n=1 이면 [end] 반환. */
function linearRamp(start: number, end: number, n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [end];
  const step = (end - start) / (n - 1);
  return Array.from({ length: n }, (_, i) => start + step * i);
}

export interface WeeklyProgression {
  multipliers: number[]; // 길이 = weekCount
  growthWeeks: number;
  taperWeeks: number;
  peakWeekIdx: number; // 0-based. Growth 마지막 주 (taper 직전).
}

/**
 * weekCount 에 따른 주간 볼륨 배율 생성.
 * @param weekCount 4 ~ 24 (호출자가 이미 validate 했다는 전제, 방어적으로 clamp).
 */
export function computeWeeklyProgression(weekCount: number): WeeklyProgression {
  const wc = clampInt(Math.round(weekCount), 4, 24);
  const taperWeeks = wc <= 8 ? 1 : 2;
  const growthWeeks = wc - taperWeeks;

  const growth = linearRamp(GROWTH_START, PEAK, growthWeeks);
  const taper = taperWeeks === 1 ? [...TAPER_1] : [...TAPER_2];

  const multipliers = [...growth, ...taper];
  const peakWeekIdx = growthWeeks - 1;

  return { multipliers, growthWeeks, taperWeeks, peakWeekIdx };
}
