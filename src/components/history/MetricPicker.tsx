// #394 (M15-2): 지표 선택. `?metric=` 서버 네비게이션 — 링크라 공유 가능하고 클라이언트 JS 가 필요 없다.
// 기본 5개 · 구분선 · 추가 지표. 목록은 레지스트리에서 나온다 (지표 추가 = 등록 1건).
import Link from "next/link";
import {
  HISTORY_PRIMARY_METRIC_IDS,
  selectableHistoryMetrics,
  type HistoryMetricDef,
  type HistoryMetricId,
} from "@/lib/history/metrics";
import { historyMetricQuery } from "@/lib/history/route-params";
import { metricColor } from "./metric-colors";

interface MetricPickerProps {
  /** 현재 레벨 경로 (`/history/2024/03`) */
  basePath: string;
  selected: HistoryMetricId;
}

function Pill({ def, basePath, active }: { def: HistoryMetricDef; basePath: string; active: boolean }) {
  const color = metricColor(def.id);
  return (
    <Link
      href={`${basePath}${historyMetricQuery(def.id)}`}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={`flex flex-none items-center gap-[7px] whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
        active ? "text-bright" : "border-border text-muted hover:border-border-hover"
      }`}
      style={active ? { borderColor: color, background: `color-mix(in srgb, ${color} 10%, transparent)` } : undefined}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: color, opacity: active ? 1 : 0.55 }} />
      {def.label}
    </Link>
  );
}

export default function MetricPicker({ basePath, selected }: MetricPickerProps) {
  const all = selectableHistoryMetrics();
  const primaryIds: readonly HistoryMetricId[] = HISTORY_PRIMARY_METRIC_IDS;
  const primary = all.filter((m) => primaryIds.includes(m.id));
  const extra = all.filter((m) => !primaryIds.includes(m.id));
  return (
    <nav aria-label="지표" className="mb-5 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
      {primary.map((def) => (
        <Pill key={def.id} def={def} basePath={basePath} active={def.id === selected} />
      ))}
      <span aria-hidden className="mx-1 my-1 w-px flex-none bg-border" />
      {extra.map((def) => (
        <Pill key={def.id} def={def} basePath={basePath} active={def.id === selected} />
      ))}
    </nav>
  );
}
