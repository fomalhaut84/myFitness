/**
 * 운동 강도 자동 분류 (M4-5).
 *
 * 데이터 소스:
 *   Garmin이 Activity.rawData에 제공하는 hrTimeInZone_1~5 (초 단위).
 *   Garmin 기본 Zone은 %maxHR 기반이지만 사용자가 Garmin Connect에서 LTHR 기반으로
 *   설정해두면 그 값이 그대로 사용됨.
 *
 * 출력:
 *   - zoneDistribution: {z1..z5} 초 단위 (raw)
 *   - estimatedZone: 1~5 (가중 평균 Zone)
 *   - intensityScore: 0~100 (TRIMP 유사)
 *   - intensityLabel: recovery|easy|tempo|threshold|interval|max
 */

import { calculateHRZone } from "./zones";

export type HRZone = 1 | 2 | 3 | 4 | 5;
export type IntensityLabel =
  | "recovery"
  | "easy"
  | "tempo"
  | "threshold"
  | "interval"
  | "max";

export interface ZoneDistribution {
  z1: number; // seconds
  z2: number;
  z3: number;
  z4: number;
  z5: number;
}

export interface IntensityClassification {
  zoneDistribution: ZoneDistribution;
  estimatedZone: HRZone;
  intensityScore: number;
  intensityLabel: IntensityLabel;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 분포 기반 분류가 의미 있는 최소 zone 시간(초). 이하면 null 처리. */
export const MIN_ZONE_TOTAL_SEC = 60;

/**
 * Garmin rawData에서 HR Zone 시간 분포를 추출.
 * 모든 zone이 0이거나 총합이 MIN_ZONE_TOTAL_SEC 미만이면 null 반환.
 */
export function extractZoneDistribution(
  rawData: Record<string, unknown> | null | undefined
): ZoneDistribution | null {
  if (!rawData) return null;
  const dist: ZoneDistribution = {
    z1: toNum(rawData.hrTimeInZone_1),
    z2: toNum(rawData.hrTimeInZone_2),
    z3: toNum(rawData.hrTimeInZone_3),
    z4: toNum(rawData.hrTimeInZone_4),
    z5: toNum(rawData.hrTimeInZone_5),
  };
  const total = dist.z1 + dist.z2 + dist.z3 + dist.z4 + dist.z5;
  if (total < MIN_ZONE_TOTAL_SEC) return null;
  return dist;
}

/** Prisma Json 값이 ZoneDistribution 형태인지 검증 후 타입 안전 캐스팅 */
export function parseZoneDistribution(
  value: unknown
): ZoneDistribution | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const z1 = Number(obj.z1);
  const z2 = Number(obj.z2);
  const z3 = Number(obj.z3);
  const z4 = Number(obj.z4);
  const z5 = Number(obj.z5);
  if (
    !Number.isFinite(z1) ||
    !Number.isFinite(z2) ||
    !Number.isFinite(z3) ||
    !Number.isFinite(z4) ||
    !Number.isFinite(z5)
  ) {
    return null;
  }
  return { z1, z2, z3, z4, z5 };
}

/** 가중 평균 Zone과 퍼센트 계산 */
function zonePercents(dist: ZoneDistribution): {
  total: number;
  pct: Record<`z${HRZone}`, number>;
  weighted: number;
} {
  const total = dist.z1 + dist.z2 + dist.z3 + dist.z4 + dist.z5;
  if (total <= 0) {
    return {
      total: 0,
      pct: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
      weighted: 0,
    };
  }
  const pct = {
    z1: dist.z1 / total,
    z2: dist.z2 / total,
    z3: dist.z3 / total,
    z4: dist.z4 / total,
    z5: dist.z5 / total,
  };
  const weighted = pct.z1 * 1 + pct.z2 * 2 + pct.z3 * 3 + pct.z4 * 4 + pct.z5 * 5;
  return { total, pct, weighted };
}

/** 분포 + avgHR(optional) 기반 강도 분류 */
export function classifyIntensity(args: {
  zoneDistribution: ZoneDistribution;
  avgHR?: number | null;
  lthr?: number | null;
}): IntensityClassification {
  const dist = args.zoneDistribution;
  const { total, pct, weighted } = zonePercents(dist);

  // 대표 Zone: 가중 평균 반올림
  const estimatedZone = Math.max(
    1,
    Math.min(5, Math.round(weighted))
  ) as HRZone;

  // 강도 점수 (TRIMP 유사): 가중 평균 × 20 → 0~100
  const intensityScore = total > 0 ? Math.min(100, weighted * 20) : 0;

  // 라벨 분류 (분포 기반 우선, avgHR+LTHR 보조).
  // 순서가 중요: 더 구체적인 조건부터 매칭.
  let label: IntensityLabel = "easy";
  if (pct.z5 > 0.3) {
    // Z5에 오래 머무름 → VO2max/무산소 최대치
    label = "max";
  } else if (pct.z5 > 0.1 && pct.z4 + pct.z5 > 0.3) {
    // Z4+Z5 반복(인터벌 특유 분포)
    label = "interval";
  } else if (pct.z4 > 0.3) {
    label = "threshold";
  } else if (pct.z3 > 0.3) {
    label = "tempo";
  } else if (pct.z1 > 0.7) {
    label = "recovery";
  } else {
    label = "easy";
  }

  // avgHR + LTHR이 제공되면 라벨을 보정 (추가 검증)
  if (args.avgHR && args.avgHR > 0 && args.lthr && args.lthr > 0) {
    const avgZone = calculateHRZone(args.avgHR, args.lthr);
    // avgHR 기반 zone이 Z4~Z5인데 분포 기반이 낮으면 threshold 이상으로 보정
    if (avgZone >= 4 && (label === "easy" || label === "tempo")) {
      label = "threshold";
    }
  }

  return {
    zoneDistribution: dist,
    estimatedZone,
    intensityScore: Number(intensityScore.toFixed(1)),
    intensityLabel: label,
  };
}

/**
 * Activity.rawData로부터 전체 분류 결과 산출.
 * 분포 데이터 없으면 null.
 */
export function computeIntensityFromRawData(args: {
  rawData: Record<string, unknown> | null | undefined;
  avgHR?: number | null;
  lthr?: number | null;
}): IntensityClassification | null {
  const dist = extractZoneDistribution(args.rawData);
  if (!dist) return null;
  return classifyIntensity({
    zoneDistribution: dist,
    avgHR: args.avgHR,
    lthr: args.lthr,
  });
}
