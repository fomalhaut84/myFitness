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
