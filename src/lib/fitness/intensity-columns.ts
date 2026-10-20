/**
 * #570: Activity 강도 컬럼 값 (순수 — prisma 의존 없음). 싱크 · 재계산이 같은 규칙으로 쓴다.
 */

import type { BasisIntensity, IntensityBasisSetting } from "./intensity";

export interface IntensityColumns {
  zoneDistribution: BasisIntensity["zoneDistribution"] | null;
  estimatedZone: number | null;
  intensityScore: number | null;
  intensityLabel: string | null;
  intensityBasis: string | null;
}

export const EMPTY_INTENSITY_COLUMNS: IntensityColumns = {
  zoneDistribution: null,
  estimatedZone: null,
  intensityScore: null,
  intensityLabel: null,
  intensityBasis: null,
};

export function toIntensityColumns(intensity: BasisIntensity | null): IntensityColumns {
  if (!intensity) return EMPTY_INTENSITY_COLUMNS;
  return {
    zoneDistribution: intensity.zoneDistribution,
    estimatedZone: intensity.estimatedZone,
    intensityScore: intensity.intensityScore,
    intensityLabel: intensity.intensityLabel,
    intensityBasis: intensity.basis,
  };
}

/**
 * 싱크 upsert update 에서 계산 결과가 null 일 때 기존 값을 비워야 하는가.
 * 심박 · 자동 기준에서 null = 이번 페이로드에 분포가 없음 → 기존 값 유지 (M4-5 규칙).
 * 파워 기준에서 null = 파워 데이터 없는 활동 → 다른 기준 값이 남지 않게 비운다 (기준 혼재 방지).
 */
export function shouldClearOnMissing(setting: IntensityBasisSetting): boolean {
  return setting === "power";
}

function sameDistribution(a: unknown, b: IntensityColumns["zoneDistribution"]): boolean {
  if (b === null) return a === null || a === undefined;
  if (typeof a !== "object" || a === null) return false;
  const o = a as Record<string, unknown>;
  return o.z1 === b.z1 && o.z2 === b.z2 && o.z3 === b.z3 && o.z4 === b.z4 && o.z5 === b.z5;
}

/** 저장된 값과 새 값이 같은가 (재계산이 바뀐 행만 update 하도록) */
export function sameIntensityColumns(
  current: {
    zoneDistribution: unknown;
    estimatedZone: number | null;
    intensityScore: number | null;
    intensityLabel: string | null;
    intensityBasis: string | null;
  },
  next: IntensityColumns
): boolean {
  return (
    sameDistribution(current.zoneDistribution, next.zoneDistribution) &&
    current.estimatedZone === next.estimatedZone &&
    current.intensityScore === next.intensityScore &&
    current.intensityLabel === next.intensityLabel &&
    current.intensityBasis === next.intensityBasis
  );
}
