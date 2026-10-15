/** #514: OMRON syncAll dataType (순수 — sync · backfill 스크립트 공용) */
export const OMRON_DATA_TYPES = ["omron_body_composition", "omron_blood_pressure"] as const;

export type OmronDataType = (typeof OMRON_DATA_TYPES)[number];

export function isOmronDataType(dataType: string): dataType is OmronDataType {
  return (OMRON_DATA_TYPES as readonly string[]).includes(dataType);
}
