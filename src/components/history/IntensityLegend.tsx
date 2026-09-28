// #394 (M15-2): 색 강도 범례. 강도는 크기이지 좋고 나쁨이 아니다 → "낮음 → 높음".
import type { HistoryMetricDef } from "@/lib/history/metrics";
import { INTENSITY_LEVEL_LIST, intensityBackground } from "./metric-colors";

export default function IntensityLegend({ metric }: { metric: HistoryMetricDef }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-sub">
      <span className="flex items-center gap-0.5">
        <span className="mr-1">낮음</span>
        {INTENSITY_LEVEL_LIST.map((level) => (
          <span key={level} className="h-3 w-3 rounded-[3px]" style={{ background: intensityBackground(metric.id, level) }} />
        ))}
        <span className="ml-1">높음</span>
      </span>
      {metric.missingAsZero && (
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[3px] bg-surface" />쉰 날
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-[3px] shadow-[inset_0_0_0_1px_#2a2a2a]" />
        기록 없음
      </span>
    </div>
  );
}
