// #394 (M15-2): 지표 선택. `?metric=` 서버 네비게이션 (`/history` · `/trends` 공용) — 링크라 공유 가능하고 클라이언트 JS 가 필요 없다.
// 기본 5개 · 구분선 · 추가 지표. 목록은 레지스트리에서 나온다 (지표 추가 = 등록 1건).
import Link from "next/link";
import {
  HISTORY_PRIMARY_METRIC_IDS,
  selectableHistoryMetrics,
  type HistoryMetricDef,
  type HistoryMetricId,
} from "@/lib/history/metrics";
import { metricColor } from "./metric-colors";

interface MetricPickerProps {
  /** 지표 id → 이동할 href. 호출자가 자기 쿼리 (`/history` 레벨 경로 · `/trends` 의 view/unit/range) 를 보존한다 (#395) */
  hrefFor: (id: HistoryMetricId) => string;
  selected: HistoryMetricId;
}

function Pill({ def, href, active }: { def: HistoryMetricDef; href: string; active: boolean }) {
  const color = metricColor(def.id);
  return (
    <Link
      href={href}
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

export default function MetricPicker({ hrefFor, selected }: MetricPickerProps) {
  const all = selectableHistoryMetrics();
  const primaryIds: readonly HistoryMetricId[] = HISTORY_PRIMARY_METRIC_IDS;
  const primary = all.filter((m) => primaryIds.includes(m.id));
  const extra = all.filter((m) => !primaryIds.includes(m.id));
  return (
    <nav aria-label="지표" className="mb-5 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
      {primary.map((def) => (
        <Pill key={def.id} def={def} href={hrefFor(def.id)} active={def.id === selected} />
      ))}
      <span aria-hidden className="mx-1 my-1 w-px flex-none bg-border" />
      {extra.map((def) => (
        <Pill key={def.id} def={def} href={hrefFor(def.id)} active={def.id === selected} />
      ))}
    </nav>
  );
}
