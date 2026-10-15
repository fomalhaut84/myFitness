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

/** Garmin 싱크가 이 source 의 행을 덮어써도 되는가 — garmin 행만 */
export function garminMayOverwrite(source: string): boolean {
  return source === "garmin";
}

/** Garmin 싱크가 덮지 않는 출처 (prisma `notIn` 조건용) */
export const GARMIN_PROTECTED_SOURCES = ["manual", "omron"] as const;
