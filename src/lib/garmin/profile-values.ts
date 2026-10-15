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

export type HrPairField = "maxHR" | "lthr";

export interface HrPairSide {
  current: number | null;
  source: string | null;
  /** 이번 싱크가 쓸 Garmin 값. undefined = 이 필드는 쓰지 않음 (보호 · endpoint 실패 · 필드 없음) */
  garmin: number | null | undefined;
}

/**
 * #510: 자동 싱크 후 상태가 LTHR ≤ maxHR (PATCH /api/profile 과 같은 기준) 을 깨는가.
 * 깨면 **수동 값과 충돌하는 Garmin 쪽** 필드를 돌려준다 — 그 갱신만 보류하고 사용자가 입력한 값을 우선한다.
 * 둘 다 Garmin 이 쓰는 값이거나 수동 쪽이 없으면 null (Garmin 값끼리의 정합은 Garmin 에 맡긴다).
 * maxHR 이 비면 API 처럼 `fallbackMaxHR` (resolveMaxHR 의 나이 기반 / 기본값) 과 비교한다 — PR #513 Codex P2.
 */
export function findHrPairConflict(
  pair: Record<HrPairField, HrPairSide>,
  fallbackMaxHR: number | null = null
): HrPairField | null {
  const next = (s: HrPairSide) => (s.garmin !== undefined ? s.garmin : s.current);
  const nextMaxHR = next(pair.maxHR) ?? fallbackMaxHR;
  const nextLthr = next(pair.lthr);
  if (nextMaxHR === null || nextLthr === null || nextLthr <= nextMaxHR) return null;
  if (pair.lthr.garmin !== undefined && pair.maxHR.source === "manual") return "lthr";
  if (pair.maxHR.garmin !== undefined && pair.lthr.source === "manual") return "maxHR";
  return null;
}

/** #515: 싱크가 이번에 쓸 Garmin 값 (findHrPairConflict 의 `garmin`). null = Garmin 이 비움 · undefined = 알 수 없음 */
export interface GarminSyncCandidates {
  maxHR: number | null | undefined;
  lthr: number | undefined;
}

/**
 * #515: 저장된 러닝 존 raw (마지막 hrZonesOk 싱크) → 싱크 후보 값.
 * maxHR: `maxHeartRateUsed` 키가 있고 null 이면 비운 것 (싱크도 null 을 쓴다) · 키 없음 · 형식 불일치는 알 수 없음.
 * LTHR: 존 값이 없으면 싱크는 user-settings 로 대체하는데 그 값은 저장하지 않으므로 알 수 없음 (스펙 #510 제외 사항).
 */
export function extractGarminSyncCandidates(raw: unknown): GarminSyncCandidates {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { maxHR: undefined, lthr: undefined };
  }
  const zone = raw as Record<string, unknown>;
  const maxHR = finiteOrNull(zone.maxHeartRateUsed);
  return {
    maxHR: maxHR ?? ("maxHeartRateUsed" in zone && zone.maxHeartRateUsed === null ? null : undefined),
    lthr: finiteOrNull(zone.lactateThresholdHeartRateUsed) ?? undefined,
  };
}

/**
 * #515: 프로필 카드의 보류 표시 — applyAutoSync 와 같은 판정 (수동 필드는 싱크가 쓰지 않음 · maxHR 이 비면 fallback 비교).
 */
export function heldHrField(args: {
  current: { maxHR: number | null; lthr: number | null };
  sources: { maxHR: string | null; lthr: string | null };
  candidates: GarminSyncCandidates;
  fallbackMaxHR: number;
}): HrPairField | null {
  const side = (field: HrPairField): HrPairSide => ({
    current: args.current[field],
    source: args.sources[field],
    garmin: canAutoUpdate(args.sources[field]) ? args.candidates[field] : undefined,
  });
  return findHrPairConflict({ maxHR: side("maxHR"), lthr: side("lthr") }, args.fallbackMaxHR);
}
