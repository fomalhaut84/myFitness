/**
 * #570: 심박 · 파워 두 기준의 강도를 따로 저장하고, 읽을 때 프로필 기준 (intensityBasis) 에 맞춰 고른다 (순수).
 * 설정을 바꿔도 저장된 값은 바뀌지 않는다 — 덮어쓰기 · 재계산 없음.
 *
 * - hr    = 심박만
 * - power = 파워 우선, 파워 값이 없는 활동 (러닝 외 · 파워 없는 러닝) 은 심박 — 부하 합계에서 빠지지 않게
 * - auto  = 심박을 믿기 어려운 상황에만 파워 (심박 영향 복약 기간 · 더위), 그 밖엔 심박 (몸이 실제로 받은 부하)
 *           심박 값이 없고 파워만 있으면 파워
 */

import { ymdKST } from "@/lib/garmin/utils";
import type { IntensityBasis, IntensityBasisSetting, IntensityClassification } from "./intensity";

/** 체감온도가 이 값 이상이면 심박이 더위로 오른다고 보고 자동 기준이 파워를 쓴다 (°C) */
export const HEAT_APPARENT_TEMP_C = 28;

/**
 * Prisma select — 강도를 읽는 곳은 이 필드를 함께 읽는다. 자동 기준 판단용 `startTime` · `weatherApparentTempC` 도
 * 필요하지만 대부분의 select 가 이미 읽어 여기엔 넣지 않는다 (중복 키) — StoredIntensity 가 필수로 요구한다.
 */
export const INTENSITY_SELECT = {
  zoneDistribution: true,
  estimatedZone: true,
  intensityScore: true,
  intensityLabel: true,
  powerZoneDistribution: true,
  powerEstimatedZone: true,
  powerIntensityScore: true,
  powerIntensityLabel: true,
} as const;

/** 자동 기준 판단 근거 — KST 날짜 (end null = 복용 중) */
export interface HrAffectedPeriod {
  start: string;
  end: string | null;
}

export interface IntensityContext {
  setting: IntensityBasisSetting;
  /** 심박 영향 복약 기간 (auto 에서만 쓴다) */
  hrAffectedPeriods: readonly HrAffectedPeriod[];
}

export const HR_ONLY_CONTEXT: IntensityContext = { setting: "hr", hrAffectedPeriods: [] };

/**
 * 고른 이유 — 화면 · AI 가 "왜 파워 / 심박" 인지 설명한다.
 * setting = 설정 그대로 · no_power = 파워 기준인데 파워 값이 없어 심박 · medication · heat = 자동이 파워를 고른 상황 ·
 * no_hr = 심박 값이 없어 파워 · normal = 자동이 심박을 고름 (특이 상황 없음) ·
 * no_power 는 자동에서도 — 복약 · 더위 상황인데 파워 값이 없어 심박 (사전 리뷰 info: "특이 상황 없음" 으로 오해하지 않게)
 */
export type IntensityBasisReason = "setting" | "no_power" | "medication" | "heat" | "no_hr" | "normal";

export interface StoredIntensity {
  startTime: Date;
  weatherApparentTempC: number | null;
  zoneDistribution: unknown;
  estimatedZone: number | null;
  intensityScore: number | null;
  intensityLabel: string | null;
  powerZoneDistribution: unknown;
  powerEstimatedZone: number | null;
  powerIntensityScore: number | null;
  powerIntensityLabel: string | null;
}

export interface SelectedIntensity {
  /** 고른 값의 기준 — 그 기준 값이 없으면 null */
  basis: IntensityBasis | null;
  reason: IntensityBasisReason | null;
  /** Prisma Json — parseZoneDistribution 으로 읽는다 */
  zoneDistribution: unknown;
  estimatedZone: number | null;
  intensityScore: number | null;
  intensityLabel: string | null;
}

const EMPTY: SelectedIntensity = {
  basis: null,
  reason: null,
  zoneDistribution: null,
  estimatedZone: null,
  intensityScore: null,
  intensityLabel: null,
};

function hasValue(v: unknown): boolean {
  return v !== null && v !== undefined;
}

function inPeriod(ymd: string, p: HrAffectedPeriod): boolean {
  return ymd >= p.start && (p.end === null || ymd <= p.end);
}

/** 활동 상황 (복약 · 더위) 이 심박을 흔드는가 — 자동 기준 판단 */
export function hrDisturbance(
  row: { startTime: Date; weatherApparentTempC: number | null },
  periods: readonly HrAffectedPeriod[]
): "medication" | "heat" | null {
  const ymd = ymdKST(row.startTime);
  if (periods.some((p) => inPeriod(ymd, p))) return "medication";
  const t = row.weatherApparentTempC;
  if (typeof t === "number" && Number.isFinite(t) && t >= HEAT_APPARENT_TEMP_C) return "heat";
  return null;
}

/** 어느 기준을 읽을지 — 값 유무 + 설정 + 상황 */
export function decideBasis(
  row: { startTime: Date; weatherApparentTempC: number | null },
  has: { hr: boolean; power: boolean },
  ctx: IntensityContext
): { basis: IntensityBasis | null; reason: IntensityBasisReason | null } {
  if (!has.hr && !has.power) return { basis: null, reason: null };
  if (ctx.setting === "hr") return has.hr ? { basis: "hr", reason: "setting" } : { basis: null, reason: null };
  if (ctx.setting === "power") {
    return has.power ? { basis: "power", reason: "setting" } : { basis: "hr", reason: "no_power" };
  }
  // auto
  const disturbance = hrDisturbance(row, ctx.hrAffectedPeriods);
  if (has.power) {
    if (disturbance) return { basis: "power", reason: disturbance };
    if (!has.hr) return { basis: "power", reason: "no_hr" };
  }
  return { basis: "hr", reason: disturbance ? "no_power" : "normal" };
}

export function selectIntensity(row: StoredIntensity, ctx: IntensityContext): SelectedIntensity {
  const has = {
    hr: hasValue(row.zoneDistribution) || row.intensityLabel !== null,
    power: hasValue(row.powerZoneDistribution) || row.powerIntensityLabel !== null,
  };
  const { basis, reason } = decideBasis(row, has, ctx);
  if (basis === null) return EMPTY;
  if (basis === "power") {
    return {
      basis,
      reason,
      zoneDistribution: row.powerZoneDistribution ?? null,
      estimatedZone: row.powerEstimatedZone,
      intensityScore: row.powerIntensityScore,
      intensityLabel: row.powerIntensityLabel,
    };
  }
  return {
    basis,
    reason,
    zoneDistribution: row.zoneDistribution ?? null,
    estimatedZone: row.estimatedZone,
    intensityScore: row.intensityScore,
    intensityLabel: row.intensityLabel,
  };
}

type PowerKeys = "powerZoneDistribution" | "powerEstimatedZone" | "powerIntensityScore" | "powerIntensityLabel";

/**
 * 행의 심박 기준 필드 자리 (zoneDistribution · estimatedZone · intensityScore · intensityLabel) 에 고른 값을 넣고
 * 파워 필드는 뺀다 + `intensityBasis` · `intensityBasisReason`. 읽는 쪽의 기존 로직은 그대로 둔다.
 */
export function applyIntensityBasis<T extends StoredIntensity>(
  row: T,
  ctx: IntensityContext
): Omit<T, PowerKeys> & { intensityBasis: IntensityBasis | null; intensityBasisReason: IntensityBasisReason | null } {
  const {
    powerZoneDistribution: _pz,
    powerEstimatedZone: _pe,
    powerIntensityScore: _ps,
    powerIntensityLabel: _pl,
    ...rest
  } = row;
  const sel = selectIntensity(row, ctx);
  return {
    ...rest,
    zoneDistribution: sel.zoneDistribution as T["zoneDistribution"],
    estimatedZone: sel.estimatedZone,
    intensityScore: sel.intensityScore,
    intensityLabel: sel.intensityLabel,
    intensityBasis: sel.basis,
    intensityBasisReason: sel.reason,
  };
}

/** 라벨만 읽는 곳 (비교 표 · 비슷한 활동) — selectIntensity 와 같은 규칙 */
export function selectIntensityLabel(
  row: {
    startTime: Date;
    weatherApparentTempC: number | null;
    intensityLabel: string | null;
    powerIntensityLabel?: string | null;
  },
  ctx: IntensityContext
): { label: string | null; basis: IntensityBasis | null } {
  const power = row.powerIntensityLabel ?? null;
  const { basis } = decideBasis(row, { hr: row.intensityLabel !== null, power: power !== null }, ctx);
  if (basis === "power") return { label: power, basis };
  if (basis === "hr") return { label: row.intensityLabel, basis };
  return { label: null, basis: null };
}

/** 계산 결과 → 파워 컬럼 쓰기 값 (null = 계산 불가 → 쓰지 않는다: 싱크 update 는 기존 값 유지) */
export function toPowerColumns(intensity: IntensityClassification): {
  powerZoneDistribution: IntensityClassification["zoneDistribution"];
  powerEstimatedZone: number;
  powerIntensityScore: number;
  powerIntensityLabel: string;
} {
  return {
    powerZoneDistribution: intensity.zoneDistribution,
    powerEstimatedZone: intensity.estimatedZone,
    powerIntensityScore: intensity.intensityScore,
    powerIntensityLabel: intensity.intensityLabel,
  };
}
