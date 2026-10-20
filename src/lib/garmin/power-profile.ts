/**
 * #570: Garmin 러닝 역치파워 · 파워 존 자동 싱크 규칙 (순수 — prisma 의존 없음).
 * LTHR 과 같은 패턴: 수동 값(`manual`)만 보호 · 파워 엔드포인트 실패/형태 불일치는 미갱신 (null 로 덮지 않음).
 */

import {
  isValidThresholdPower,
  parseRunningPowerZones,
  type GarminPowerZonesRaw,
} from "@/lib/fitness/power-zones";
import { canAutoUpdate } from "./profile-values";

/** naive 로컬 "YYYY-MM-DDTHH:mm:ss(.S)" → KST 로 해석 (memory: Garmin API naive-TZ) */
const NAIVE_LOCAL_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?$/;

export function parseNaiveKst(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = NAIVE_LOCAL_RE.exec(value);
  if (!m) return null;
  const d = new Date(`${m[1]}+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface LatestThresholdPower {
  value: number;
  measuredAt: Date | null;
}

/** latestFunctionalThresholdPower/RUNNING 응답 → 값 · 시각. 형태가 다르거나 범위 밖이면 null */
export function parseLatestThresholdPower(value: unknown): LatestThresholdPower | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (obj.sport !== undefined && obj.sport !== "RUNNING") return null;
  const ftp = obj.functionalThresholdPower;
  if (!isValidThresholdPower(ftp)) return null;
  return { value: ftp, measuredAt: parseNaiveKst(obj.calendarDate) };
}

export interface PowerProfileState {
  thresholdPower: number | null;
  thresholdPowerSource: string | null;
}

export interface PowerSyncInput {
  /** powerZones/sports/all 응답 (실패면 undefined) */
  powerZones: unknown;
  /** latestFunctionalThresholdPower/RUNNING 응답 (실패면 undefined) */
  latest: unknown;
  /** user-settings userData.ftpAutoDetected (필드 없음 · 실패면 undefined) */
  ftpAutoDetected: boolean | null | undefined;
}

export interface PowerSyncPlan {
  updates: {
    thresholdPower?: number;
    thresholdPowerSource?: "garmin";
    thresholdPowerAutoDetected?: boolean | null;
    thresholdPowerMeasuredAt?: Date | null;
    powerZonesRaw?: GarminPowerZonesRaw;
  };
  /** 값이 바뀌면 MetricChange 기록용 */
  change: { oldValue: number | null; newValue: number } | null;
  /** 범위 밖 · 형태 불일치 로그용 */
  warnings: string[];
}

/**
 * 싱크 계획: 존 원본은 매번 갱신 (수동 보호와 무관 — heartRateZonesRaw 와 같다).
 * 역치파워 값 = 존 원본의 FTP 우선, 없으면 latest. 메타(감지 여부 · 시각)는 값과 함께 수동 보호.
 * Garmin 이 값을 비우는 경우 (null) 는 응답 형태로 구분할 수 없어 지우지 않는다.
 */
export function planPowerSync(profile: PowerProfileState, input: PowerSyncInput): PowerSyncPlan {
  const warnings: string[] = [];
  const zones = input.powerZones === undefined ? null : parseRunningPowerZones(input.powerZones);
  if (input.powerZones !== undefined && zones === null) warnings.push("powerZones RUNNING 형태 불일치 · 없음");
  const latest = input.latest === undefined ? null : parseLatestThresholdPower(input.latest);
  if (input.latest !== undefined && latest === null) warnings.push("latestFunctionalThresholdPower 형태 불일치 · 범위 밖");

  const zonesFtp = zones && isValidThresholdPower(zones.functionalThresholdPower) ? zones.functionalThresholdPower : null;
  if (zones && zonesFtp === null) warnings.push(`powerZones 역치파워 범위 밖: ${zones.functionalThresholdPower}`);
  const garminValue = zonesFtp ?? latest?.value ?? null;

  const updates: PowerSyncPlan["updates"] = {};
  if (zones && zonesFtp !== null) updates.powerZonesRaw = zones;

  let change: PowerSyncPlan["change"] = null;
  if (garminValue !== null && canAutoUpdate(profile.thresholdPowerSource)) {
    if (profile.thresholdPower !== garminValue) {
      updates.thresholdPower = garminValue;
      change = { oldValue: profile.thresholdPower, newValue: garminValue };
    }
    if (profile.thresholdPowerSource !== "garmin") updates.thresholdPowerSource = "garmin";
    // 시각은 latest 값이 같은 FTP 를 가리킬 때만 (존 원본과 다른 시점 값이면 신뢰하지 않음).
    // 값이 바뀌었는데 맞는 시각이 없으면 비운다 — 새 FTP 에 이전 FTP 의 감지 시각이 붙지 않게 (PR #571 Codex P2)
    if (latest && latest.value === garminValue) updates.thresholdPowerMeasuredAt = latest.measuredAt;
    else if (change) updates.thresholdPowerMeasuredAt = null;
    if (input.ftpAutoDetected !== undefined) updates.thresholdPowerAutoDetected = input.ftpAutoDetected;
  }

  return { updates, change, warnings };
}
