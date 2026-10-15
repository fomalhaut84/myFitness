/**
 * #514: OMRON · Garmin 이 같은 날짜 행을 두고 만날 때의 규칙 (순수). 2026-10-15 사용자 결정 — OMRON 우선 · manual 보호.
 * Garmin 혈압 · 체중은 OMRON 값을 손으로 옮겨 적은 사본이라 OMRON 이 상위집합이다 (스펙 §7).
 */

export type OmronWriteAction = "create" | "replace_garmin" | "update" | "skip";

/** 기존 행의 source (없으면 null) → OMRON 저장 동작 */
export function omronWriteAction(existingSource: string | null): OmronWriteAction {
  if (existingSource === null) return "create";
  if (existingSource === "garmin") return "replace_garmin";
  if (existingSource === "omron") return "update";
  return "skip"; // manual · 알 수 없는 출처는 건드리지 않는다
}

/** Garmin 싱크가 덮지 않는 출처 (prisma `notIn` 조건용) */
export const GARMIN_PROTECTED_SOURCES: readonly string[] = ["manual", "omron"];

/** Garmin 싱크가 이 source 의 행을 덮어써도 되는가 — 보호 상수와 같은 정의 (사전 리뷰 info 2) */
export function garminMayOverwrite(source: string): boolean {
  return !GARMIN_PROTECTED_SOURCES.includes(source);
}

/**
 * OMRON 행 rawData.replacedGarmin 에 둘 값 (사전 리뷰 info 3).
 * Garmin 행을 교체하면 그 행의 기존 값 스냅샷, OMRON 행 갱신이면 이전에 보존한 원본을 유지, 없으면 undefined.
 */
export function garminArchive(action: OmronWriteAction, existingRawData: unknown, snapshot: unknown): unknown {
  if (action === "replace_garmin") return snapshot;
  if (typeof existingRawData !== "object" || existingRawData === null) return undefined;
  const kept = (existingRawData as { replacedGarmin?: unknown }).replacedGarmin;
  return kept === undefined || kept === null ? undefined : kept;
}
