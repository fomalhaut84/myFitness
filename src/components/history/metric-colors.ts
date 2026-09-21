// #394 (M15-2): 지표 색. 화면에는 한 번에 한 지표 색만 나온다 — "지금 무엇을 보고 있는가" 의 표시
// (docs/designs/394-history/design-notes.md). 표시 관심사라 레지스트리(lib)가 아니라 여기 둔다.
import type { HistoryMetricId } from "@/lib/history/metrics";
import type { IntensityLevel } from "@/lib/history/intensity";

const FALLBACK_COLOR = "#a3a3a3";

const METRIC_COLORS: Partial<Record<HistoryMetricId, string>> = {
  runningKm: "#22c55e", // 앱 accent — lifestyle 히트맵과 같은 의미
  runningCount: "#86efac",
  steps: "#fbbf24",
  activeCalories: "#f59e0b",
  sleepScore: "#a78bfa", // SleepScoreChart 의 기존 바이올렛
  restingHR: "#f87171",
  hrv: "#c084fc",
  stress: "#fb7185",
  weight: "#2dd4bf", // SpO2 의 sky(#38bdf8) 와 구별되는 teal
  vo2max: "#fb923c",
  ltPace: "#fdba74",
  calorieBalance: "#e879f9",
  intakeKcal: "#f472b6",
};

/** 강도 단계별 지표색 혼합 비율 (%) — 바탕은 --card */
const LEVEL_MIX: Record<IntensityLevel, number> = { 1: 14, 2: 26, 3: 40, 4: 56, 5: 74 };

/** 이 단계부터 셀 안의 날짜 글자를 밝게 (진한 배경 위 가독성) */
export const HOT_LEVEL: IntensityLevel = 3;

export function metricColor(id: HistoryMetricId): string {
  return METRIC_COLORS[id] ?? FALLBACK_COLOR;
}

export function intensityBackground(id: HistoryMetricId, level: IntensityLevel): string {
  return `color-mix(in srgb, ${metricColor(id)} ${LEVEL_MIX[level]}%, var(--card))`;
}

export const INTENSITY_LEVEL_LIST: readonly IntensityLevel[] = [1, 2, 3, 4, 5];
