/**
 * 측정 출처 표시 (#514 — OMRON 직접 연동으로 garmin · manual · omron 세 가지). 화면 · MCP · CSV 공용.
 */
const DATA_SOURCE_LABELS: Record<string, string> = {
  garmin: "Garmin",
  omron: "OMRON",
  manual: "직접 입력",
};

export function dataSourceLabel(source: string | null | undefined): string | null {
  if (source === null || source === undefined) return null;
  return DATA_SOURCE_LABELS[source] ?? source;
}

/** BodyComposition.muscleMass 의미 — OMRON 은 골격근량 (kg), Garmin · 직접 입력은 근육량 (스펙 S3) */
export function muscleMassLabel(source: string): string {
  return source === "omron" ? "골격근량" : "근육량";
}

/**
 * muscleMass 를 출처별 의미로 나눈다 — OMRON 은 skeletalMuscleMass (골격근량), 그 외는 muscleMass (근육량).
 * 둘을 한 필드로 집계하면 출처가 바뀐 주 · 달 평균이 의미 없어진다 (#514 PR 2 사전 리뷰 major 1 · MCP 주/월 집계).
 */
export function splitMuscleMass<T extends { muscleMass: number | null; source: string }>(
  row: T
): T & { skeletalMuscleMass: number | null } {
  const isOmron = row.source === "omron";
  return { ...row, muscleMass: isOmron ? null : row.muscleMass, skeletalMuscleMass: isOmron ? row.muscleMass : null };
}
