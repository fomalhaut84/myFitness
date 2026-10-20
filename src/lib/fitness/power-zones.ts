/**
 * 러닝 파워 존 (#570) — `zones.ts` (심박 존) 와 대칭.
 *
 * 경계: Garmin 러닝 파워 존 실측 비율 (역치파워 대비, 2026-10-20 powerZones/sports/all) — Stryd 구간과 같다.
 * 심박 존 (Friel) 보다 의미가 한 칸 위 — 파워 Z3 이 역치 (intensity.ts classifyPowerIntensity).
 * - Zone 1: 65% 이상 (이지)
 * - Zone 2: 80% 이상 (중강도)
 * - Zone 3: 90% 이상 (역치)
 * - Zone 4: 100% 이상 (인터벌)
 * - Zone 5: 115% 이상 (반복)
 */

export type PowerZone = 1 | 2 | 3 | 4 | 5;

export const POWER_ZONE_FLOOR_RATIOS = [0.65, 0.8, 0.9, 1.0, 1.15] as const;

/** 역치파워 입력 · 싱크 허용 범위 (W) */
export const THRESHOLD_POWER_MIN = 50;
export const THRESHOLD_POWER_MAX = 1000;

export const POWER_ZONE_LABELS = ["이지", "중강도", "역치", "인터벌", "반복"] as const;

export interface PowerZoneRange {
  zone: PowerZone;
  min: number; // W
  max: number | null; // W (null = 상한 없음)
  label: string;
}

export function isValidThresholdPower(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= THRESHOLD_POWER_MIN &&
    value <= THRESHOLD_POWER_MAX
  );
}

function rangesFromFloors(floors: readonly number[]): PowerZoneRange[] {
  return floors.map((min, i) => ({
    zone: (i + 1) as PowerZone,
    min,
    max: i < floors.length - 1 ? floors[i + 1] - 1 : null,
    label: POWER_ZONE_LABELS[i],
  }));
}

/** 역치파워 기반 존 경계 (W) */
export function getPowerZoneRanges(thresholdPower: number): PowerZoneRange[] {
  if (thresholdPower <= 0) throw new Error("thresholdPower must be positive");
  return rangesFromFloors(POWER_ZONE_FLOOR_RATIOS.map((r) => Math.round(thresholdPower * r)));
}

/** Garmin powerZones RUNNING 항목 원본 (UserProfile.powerZonesRaw) */
export interface GarminPowerZonesRaw {
  sport: "RUNNING";
  functionalThresholdPower: number;
  zone1Floor: number;
  zone2Floor: number;
  zone3Floor: number;
  zone4Floor: number;
  zone5Floor: number;
}

function positiveNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * 외부 JSON (Garmin 응답 · 저장된 powerZonesRaw) → RUNNING 존 원본. 형태가 다르면 null.
 * 배열이면 RUNNING 항목을 고르고, 객체면 그 자체를 검증한다.
 * 존 하한은 양수 · 오름차순이어야 한다 (러닝은 zone6/7Floor = 0 — 쓰지 않음).
 */
export function parseRunningPowerZones(value: unknown): GarminPowerZonesRaw | null {
  const item = Array.isArray(value)
    ? value.find((z) => typeof z === "object" && z !== null && (z as Record<string, unknown>).sport === "RUNNING")
    : value;
  if (typeof item !== "object" || item === null) return null;
  const obj = item as Record<string, unknown>;
  if (obj.sport !== "RUNNING") return null;
  const ftp = positiveNumber(obj.functionalThresholdPower);
  const floors = [obj.zone1Floor, obj.zone2Floor, obj.zone3Floor, obj.zone4Floor, obj.zone5Floor].map(positiveNumber);
  if (ftp === null || floors.some((f) => f === null)) return null;
  const f = floors as number[];
  if (f.some((v, i) => i > 0 && v <= f[i - 1])) return null;
  return {
    sport: "RUNNING",
    functionalThresholdPower: ftp,
    zone1Floor: f[0],
    zone2Floor: f[1],
    zone3Floor: f[2],
    zone4Floor: f[3],
    zone5Floor: f[4],
  };
}

/** Garmin 이 계산한 존 하한 → 존 범위 */
export function garminPowerZoneRanges(raw: GarminPowerZonesRaw): PowerZoneRange[] {
  return rangesFromFloors([raw.zone1Floor, raw.zone2Floor, raw.zone3Floor, raw.zone4Floor, raw.zone5Floor]);
}

/** 파워가 속한 존 (역치 대비 비율 · 65% 미만은 1) */
export function calculatePowerZone(power: number, thresholdPower: number): PowerZone {
  if (thresholdPower <= 0) throw new Error("thresholdPower must be positive");
  const pct = power / thresholdPower;
  for (let i = POWER_ZONE_FLOOR_RATIOS.length - 1; i > 0; i--) {
    if (pct >= POWER_ZONE_FLOOR_RATIOS[i]) return (i + 1) as PowerZone;
  }
  return 1;
}

export interface ProfilePowerZones {
  thresholdPower: number;
  zones: PowerZoneRange[];
  source: "garmin" | "calculated";
}

/**
 * 프로필의 파워 존 — Garmin 존은 역치파워가 Garmin 값이고 원본 FTP 가 현재 값과 같을 때만 (심박 존 규칙과 같다).
 * 수동 역치파워 · 원본 불일치면 비율 계산. 역치파워가 없으면 null.
 */
export function resolveProfilePowerZones(profile: {
  thresholdPower: number | null;
  thresholdPowerSource: string | null;
  powerZonesRaw: unknown;
}): ProfilePowerZones | null {
  const ftp = profile.thresholdPower;
  if (ftp === null || ftp <= 0) return null;
  const raw = profile.thresholdPowerSource === "garmin" ? parseRunningPowerZones(profile.powerZonesRaw) : null;
  if (raw && raw.functionalThresholdPower === ftp) {
    return { thresholdPower: ftp, zones: garminPowerZoneRanges(raw), source: "garmin" };
  }
  return { thresholdPower: ftp, zones: getPowerZoneRanges(ftp), source: "calculated" };
}
