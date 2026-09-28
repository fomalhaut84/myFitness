/**
 * #394 (M15-2): 지표 값 표시. 순수 · def (`decimals`) 만 보고 렌더 — 지표 추가가 레지스트리 1건으로 끝나게.
 * 수치 단위 규칙 (km 2자리 · bpm 정수 · kg 1자리 · kcal 정수) 은 레지스트리의 `decimals` 가 정본.
 */
import { formatPace } from "@/lib/format";
import type { HistoryMetricDef } from "./metrics";

type FormatDef = Pick<HistoryMetricDef, "decimals"> & Partial<Pick<HistoryMetricDef, "format" | "unit">>;

/** 화면 단위. pace 지표는 레지스트리 단위가 `sec/km` (API 값 기준) 지만 화면에는 `5'21"/km` 로 그린다 (PR #402 Codex P2). */
export function historyDisplayUnit(def: Pick<HistoryMetricDef, "format" | "unit">): string {
  return def.format === "pace" ? "/km" : def.unit;
}

export function formatHistoryValue(def: FormatDef, value: number): string {
  if (def.format === "pace") return formatPace(value);
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: def.decimals,
    maximumFractionDigits: def.decimals,
  });
}

/**
 * 달력 셀 (360px 에서 약 44px) 용 축약. 정식 표기는 aria-label · KPI · 일 뷰가 맡는다.
 * 1만 이상 → `12.3k`, 소수 2자리 지표 → 1자리.
 */
export function formatHistoryCellValue(def: FormatDef, value: number): string {
  if (def.format === "pace") return formatPace(value);
  if (Math.abs(value) >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  if (def.decimals >= 2) return value.toFixed(1);
  return formatHistoryValue(def, value);
}
