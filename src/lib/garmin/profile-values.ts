/**
 * #505: Garmin 프로필 자동 싱크 규칙 · 저장된 Garmin 값 파싱 (순수 — prisma 의존 없음).
 */

/**
 * 자동 싱크가 이 필드를 갱신해도 되는가.
 * 사용자가 명시적으로 입력한 값(`manual`)만 보호한다. 이전 규칙은 "source null + 값 있음"도
 * 마이그레이션 전 수동값으로 보고 막았는데, source 컬럼 이전부터 값이 있던 프로필은 그 때문에
 * 한 번도 자동 갱신되지 않았다. 덮어쓰더라도 이전 값은 MetricChange 에 남는다.
 */
export function canAutoUpdate(source: string | null): boolean {
  return source !== "manual";
}

export interface GarminZoneValues {
  maxHR: number | null;
  lthr: number | null;
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * UserProfile.heartRateZonesRaw (러닝 존 원본 · 매 싱크 갱신 — 수동 보호와 무관) 에서
 * 현재 Garmin maxHR · LTHR 을 꺼낸다. 외부 JSON 이라 형태가 다르면 null.
 */
export function extractGarminZoneValues(raw: unknown): GarminZoneValues {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { maxHR: null, lthr: null };
  }
  const zone = raw as Record<string, unknown>;
  return {
    maxHR: finiteOrNull(zone.maxHeartRateUsed),
    lthr: finiteOrNull(zone.lactateThresholdHeartRateUsed),
  };
}
