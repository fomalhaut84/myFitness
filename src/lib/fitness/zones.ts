/**
 * LTHR(젖산역치 심박수) 기반 HR Zone 계산.
 *
 * Zone 기준 (Joe Friel, "Training and Racing with a Power Meter" 및 The Triathlete's Training Bible):
 * - Zone 1: < 80% LTHR (회복)
 * - Zone 2: 80-89% LTHR (이지런, 유산소 베이스)
 * - Zone 3: 89-94% LTHR (에어로빅/템포)
 * - Zone 4: 94-99% LTHR (역치)
 * - Zone 5: ≥ 100% LTHR (VO2max/무산소)
 */

export type HRZone = 1 | 2 | 3 | 4 | 5;

export const ZONE_BOUNDARIES = [0.8, 0.89, 0.94, 1.0] as const;

export interface ZoneRange {
  zone: HRZone;
  min: number | null; // 최소 bpm (null = 하한 없음)
  max: number | null; // 최대 bpm (null = 상한 없음)
  label: string;
}

/** HR이 속한 Zone 번호 반환 (1~5) */
export function calculateHRZone(hr: number, lthr: number): HRZone {
  if (lthr <= 0) throw new Error("LTHR must be positive");
  const pct = hr / lthr;
  if (pct >= ZONE_BOUNDARIES[3]) return 5;
  if (pct >= ZONE_BOUNDARIES[2]) return 4;
  if (pct >= ZONE_BOUNDARIES[1]) return 3;
  if (pct >= ZONE_BOUNDARIES[0]) return 2;
  return 1;
}

/** LTHR 기반 Zone 경계 bpm 배열 */
export function getZoneRanges(lthr: number, maxHR?: number | null): ZoneRange[] {
  if (lthr <= 0) throw new Error("LTHR must be positive");
  const b = ZONE_BOUNDARIES.map((r) => Math.round(lthr * r));
  return [
    { zone: 1, min: null, max: b[0] - 1, label: "회복" },
    { zone: 2, min: b[0], max: b[1] - 1, label: "이지런" },
    { zone: 3, min: b[1], max: b[2] - 1, label: "에어로빅" },
    { zone: 4, min: b[2], max: b[3] - 1, label: "역치" },
    { zone: 5, min: b[3], max: maxHR ?? null, label: "VO2max" },
  ];
}

/** HR 시계열 → Zone별 초 합계 */
export function computeZoneDistribution(
  hrSeries: readonly number[],
  lthr: number
): Record<`z${HRZone}`, number> {
  const dist = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  for (const hr of hrSeries) {
    if (!Number.isFinite(hr) || hr <= 0) continue;
    const z = calculateHRZone(hr, lthr);
    dist[`z${z}` as const]++;
  }
  return dist;
}

/** Zone별 백분율 (합계 100) */
export function zoneDistributionPercent(
  dist: Record<`z${HRZone}`, number>
): Record<`z${HRZone}`, number> {
  const total = dist.z1 + dist.z2 + dist.z3 + dist.z4 + dist.z5;
  if (total === 0) return { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  return {
    z1: Number(((dist.z1 / total) * 100).toFixed(1)),
    z2: Number(((dist.z2 / total) * 100).toFixed(1)),
    z3: Number(((dist.z3 / total) * 100).toFixed(1)),
    z4: Number(((dist.z4 / total) * 100).toFixed(1)),
    z5: Number(((dist.z5 / total) * 100).toFixed(1)),
  };
}

/** maxHR fallback: UserProfile.maxHR → 220 - age → 190 */
export function resolveMaxHR(profile: {
  maxHR?: number | null;
  birthDate?: Date | null;
}): number {
  if (profile.maxHR && profile.maxHR > 0) return profile.maxHR;
  if (profile.birthDate) {
    const age = Math.floor(
      (Date.now() - profile.birthDate.getTime()) /
        (365.25 * 24 * 60 * 60 * 1000)
    );
    if (age > 0 && age < 120) return 220 - age;
  }
  return 190;
}

/** LTHR fallback: UserProfile.lthr → maxHR × 0.9 */
export function resolveLTHR(profile: {
  lthr?: number | null;
  maxHR?: number | null;
  birthDate?: Date | null;
}): number {
  if (profile.lthr && profile.lthr > 0) return profile.lthr;
  return Math.round(resolveMaxHR(profile) * 0.9);
}
