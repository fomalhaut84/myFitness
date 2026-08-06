// #278: Garmin activity rawData 에서 러닝 다이나믹스 필드 추출.
// 이전 fetcher 는 존재하지 않는 `summaryDTO.*` 경로에서 찾아 전부 null 저장. Garmin API 는
// top-level 에 필드를 두며 이름도 다름 — 실제 관찰된 페이로드 기준으로 정정.
// sync fetcher + backfill 스크립트 양쪽에서 재사용.

export interface RunningDynamics {
  avgCadence: number | null;             // spm (steps per minute, 정수)
  avgStrideLength: number | null;        // meters (schema 정의) — Garmin 은 cm 로 반환, 파서에서 ÷100 변환
  avgVerticalOscillation: number | null; // cm
  avgGroundContactTime: number | null;   // ms
  aerobicTE: number | null;              // 유산소 트레이닝 이펙트 (0~5)
  anaerobicTE: number | null;            // 무산소 트레이닝 이펙트 (0~5)
  trainingEffect: number | null;         // 대표값. aerobicTE 와 동일 개념 (기존 컬럼 유지 목적)
}

function toInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toFloat(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * rawData 로부터 러닝 다이나믹스 필드 추출. 필드가 없거나 non-number 이면 null.
 *
 * 실제 Garmin `/activities/list` 응답 필드 (실측):
 *  - averageRunningCadenceInStepsPerMinute (spm)
 *  - avgStrideLength
 *  - avgVerticalOscillation
 *  - avgGroundContactTime
 *  - aerobicTrainingEffect
 *  - anaerobicTrainingEffect
 *
 * Fallback: 혹시 다른 endpoint (예: 상세 조회) 에서 summaryDTO 경로가 있으면 그것도 시도.
 */
export function parseRunningDynamics(rawData: unknown): RunningDynamics {
  if (!rawData || typeof rawData !== "object") {
    return emptyRunningDynamics();
  }
  const raw = rawData as Record<string, unknown>;
  const summary = (raw.summaryDTO ?? {}) as Record<string, unknown>;

  const cadence =
    toFloat(raw.averageRunningCadenceInStepsPerMinute) ??
    toFloat(summary.averageRunningCadenceInStepsPerMinute) ??
    toFloat(summary.averageRunCadence);
  // Garmin `avgStrideLength` 는 cm (실측 ~86 = 86cm). schema/UI 는 m 기준이므로 ÷100 변환.
  const strideLengthCm =
    toFloat(raw.avgStrideLength) ?? toFloat(summary.strideLength);
  const strideLength = strideLengthCm !== null ? strideLengthCm / 100 : null;
  const verticalOscillation =
    toFloat(raw.avgVerticalOscillation) ??
    toFloat(summary.verticalOscillation);
  const groundContactTime =
    toFloat(raw.avgGroundContactTime) ?? toFloat(summary.groundContactTime);
  const aerobicTE =
    toFloat(raw.aerobicTrainingEffect) ?? toFloat(summary.trainingEffect);
  const anaerobicTE =
    toFloat(raw.anaerobicTrainingEffect) ??
    toFloat(summary.anaerobicTrainingEffect);
  const trainingEffect = aerobicTE; // 대표값 = 유산소 TE (기존 컬럼 의미 유지)

  return {
    avgCadence: cadence !== null ? Math.round(cadence) : null,
    avgStrideLength: strideLength,
    avgVerticalOscillation: verticalOscillation,
    avgGroundContactTime: groundContactTime,
    aerobicTE,
    anaerobicTE,
    trainingEffect,
  };
}

export function emptyRunningDynamics(): RunningDynamics {
  return {
    avgCadence: null,
    avgStrideLength: null,
    avgVerticalOscillation: null,
    avgGroundContactTime: null,
    aerobicTE: null,
    anaerobicTE: null,
    trainingEffect: null,
  };
}

export { toInt as _toIntForTest };
