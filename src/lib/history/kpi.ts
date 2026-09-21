/**
 * #394 (M15-2): `/history` 연·월 KPI 7종. 순수 — summary 버킷 값 → 표시 항목.
 *
 * KPI 는 **그 기간을 한 버킷으로 롤업한 값** 에서 만든다 (연 뷰 = granularity year, 월 뷰 = month).
 * 월 버킷 평균을 다시 평균 내면 틀린다 (평균의 평균). 평균 페이스도 활동별 페이스 평균이 아니라 시간 합 / 거리 합.
 */
import { formatPace } from "@/lib/format";
import { formatHistoryValue } from "./format";
import { getHistoryMetric, type HistoryMetricId } from "./metrics";
import type { BucketValue } from "./rollup";

export const HISTORY_KPI_METRIC_IDS = [
  "runningKm",
  "runningCount",
  "runningDurationSec",
  "vo2max",
  "restingHR",
  "sleepScore",
  "weight",
] as const satisfies readonly HistoryMetricId[];

export interface HistoryKpi {
  key: string;
  label: string;
  /** null = 기록 없음 */
  text: string | null;
  unit: string;
}

export type HistoryBucketValues = Partial<Record<HistoryMetricId, BucketValue>>;

/** sec/km. 거리 0 · 결측이면 null. */
export function averagePaceSecPerKm(durationSec: number | null | undefined, km: number | null | undefined): number | null {
  if (typeof durationSec !== "number" || typeof km !== "number") return null;
  if (km <= 0 || durationSec <= 0) return null;
  return durationSec / km;
}

function metricText(id: HistoryMetricId, value: number | null | undefined): string | null {
  return typeof value === "number" ? formatHistoryValue(getHistoryMetric(id), value) : null;
}

export function buildHistoryKpis(values: HistoryBucketValues): HistoryKpi[] {
  const pace = averagePaceSecPerKm(values.runningDurationSec?.value, values.runningKm?.value);
  return [
    { key: "km", label: "총 거리", text: metricText("runningKm", values.runningKm?.value), unit: "km" },
    { key: "count", label: "러닝", text: metricText("runningCount", values.runningCount?.value), unit: "회" },
    { key: "pace", label: "평균 페이스", text: pace === null ? null : formatPace(pace), unit: "/km" },
    { key: "vo2max", label: "최고 VO2max", text: metricText("vo2max", values.vo2max?.value), unit: "" },
    { key: "rhr", label: "평균 안정시 심박", text: metricText("restingHR", values.restingHR?.value), unit: "bpm" },
    { key: "sleep", label: "평균 수면 점수", text: metricText("sleepScore", values.sleepScore?.value), unit: "점" },
    { key: "weight", label: "기간 말 체중", text: metricText("weight", values.weight?.last), unit: "kg" },
  ];
}
