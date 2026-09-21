// #395 (M15-3): 차트 축 · 툴팁 포맷터. 순수 함수로 분리해 테스트한다 (memory `feedback_recharts_defaults` —
// Recharts 는 포맷터에 예상과 다른 타입을 넘길 수 있다. 숫자가 아니면 빈 문자열).
import { formatPace } from "@/lib/format";
import { formatHistoryValue, historyDisplayUnit } from "@/lib/history/format";
import type { HistoryMetricDef } from "@/lib/history/metrics";

export type ChartMetric = Pick<HistoryMetricDef, "id" | "label" | "unit" | "decimals" | "format" | "aggregate" | "withMinMax" | "missingAsZero">;

const THOUSAND_ABBREVIATION_FROM = 10_000;

/** Y 축 눈금 — 좁은 축 (40px) 에 들어가게 축약. */
export function formatAxisValue(metric: Pick<ChartMetric, "format" | "decimals">, value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  if (metric.format === "pace") return formatPace(value);
  if (Math.abs(value) >= THOUSAND_ABBREVIATION_FROM) return `${Math.round(value / 1000)}k`;
  // 눈금은 Recharts 가 고른 값이라 소수가 길 수 있다 — 지표 소수 자리 (최대 1) 로 자른다
  return value.toLocaleString("ko-KR", { maximumFractionDigits: Math.min(1, metric.decimals) });
}

/** 툴팁 · 판독값 — 정식 표기 + 단위. null 은 "기록 없음". */
export function formatChartValue(metric: Pick<ChartMetric, "format" | "decimals" | "unit">, value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "기록 없음";
  const unit = historyDisplayUnit(metric);
  return `${formatHistoryValue(metric, value)}${unit ? ` ${unit}` : ""}`;
}

export function aggregateCaption(metric: Pick<ChartMetric, "aggregate" | "withMinMax">): string {
  if (metric.aggregate === "sum") return "막대 = 기간 합계";
  if (metric.aggregate === "max") return "선 = 기간 최고";
  if (metric.aggregate === "last") return "선 = 기간 말 값";
  return metric.withMinMax ? "선 = 기간 평균, 띠 = 최저~최고" : "선 = 기간 평균";
}

export const CHART_AXIS_TICK = { fontSize: 10, fill: "#525252" } as const;
export const CHART_GRID_STROKE = "#1f1f1f";
export const CHART_TOOLTIP_CLASS =
  "rounded-lg border border-border-hover bg-surface px-3 py-2 text-[12px] leading-relaxed text-muted shadow-lg";
