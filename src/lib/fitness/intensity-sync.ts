/**
 * #572: 재싱크가 이미 저장된 강도 값을 덮어쓰지 않게 (순수). 각 활동은 처음 계산한 시점의 역치 (LTHR · 역치파워) 로 고정된다 —
 * 일일 cron 이 최근 30일만 새 역치로 다시 분류해 라벨이 섞이던 것을 막는다 (사용자 결정 2026-10-20 · 선택지 1 · 과거 기록 덮어쓰기 금지).
 * 다시 분류가 필요하면 `scripts/backfill-intensity.ts --force`.
 */

const HR_KEYS = ["zoneDistribution", "estimatedZone", "intensityScore", "intensityLabel"] as const;
const POWER_KEYS = ["powerZoneDistribution", "powerEstimatedZone", "powerIntensityScore", "powerIntensityLabel"] as const;

export interface StoredLabels {
  intensityLabel: string | null;
  powerIntensityLabel: string | null;
}

/**
 * upsert update 에 넣을 강도 필드 — 이미 값이 있는 기준은 뺀다.
 * 예외: 파워 값을 비우는 쓰기 (`powerIntensityLabel: null` · 러닝 외로 종류가 바뀐 활동 #575) 는 그대로 둔다.
 */
export function keepStoredIntensity(
  fields: Record<string, unknown>,
  existing: StoredLabels | undefined
): Record<string, unknown> {
  if (!existing) return fields;
  const drop = new Set<string>();
  if (existing.intensityLabel !== null) HR_KEYS.forEach((k) => drop.add(k));
  const clearsPower = "powerIntensityLabel" in fields && fields.powerIntensityLabel === null;
  if (existing.powerIntensityLabel !== null && !clearsPower) POWER_KEYS.forEach((k) => drop.add(k));
  return Object.fromEntries(Object.entries(fields).filter(([k]) => !drop.has(k)));
}
