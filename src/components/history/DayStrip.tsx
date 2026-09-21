// #394 (M15-2): 월 뷰 일별 스트립 — 선택 지표의 그 달 모양. 막대가 곧 일 뷰 링크.
// 그리드가 이미 값을 보여 주므로 축·툴팁이 있는 차트(Recharts) 대신 링크 막대로 가볍게 둔다 (서버 렌더 · JS 없음).
import Link from "next/link";
import { formatHistoryValue } from "@/lib/history/format";
import type { HistoryMetricDef } from "@/lib/history/metrics";
import { historyDayPath, historyMetricQuery } from "@/lib/history/route-params";
import { buildStripScale } from "@/lib/history/strip-scale";
import type { HistoryDayCell } from "@/lib/history/view";
import { metricColor } from "./metric-colors";

interface DayStripProps {
  cells: readonly HistoryDayCell[];
  metric: HistoryMetricDef;
}

export default function DayStrip({ cells, metric }: DayStripProps) {
  const values = cells.flatMap((c) => (c.state === "value" && c.value !== null ? [c.value] : []));
  const toPercent = buildStripScale(values, metric.aggregate === "sum");
  const color = metricColor(metric.id);

  return (
    <section className="mt-7">
      <h2 className="mb-2.5 text-[13px] font-medium text-muted">
        {metric.label} 일별{metric.unit && <span className="font-normal text-sub"> ({metric.unit})</span>}
      </h2>
      <div className="flex h-[72px] items-end gap-0.5 border-b border-border">
        {cells.map((cell) => {
          if (cell.state === "value" && cell.value !== null) {
            const percent = toPercent(cell.value);
            const label = `${cell.day}일 ${formatHistoryValue(metric, cell.value)}${metric.unit}`;
            return (
              <Link
                key={cell.ymd}
                href={`${historyDayPath(cell.ymd)}${historyMetricQuery(metric.id)}`}
                title={label}
                aria-label={label}
                className="min-w-0 flex-1 rounded-t-sm opacity-75 hover:opacity-100"
                style={{ height: `${percent}%`, background: color }}
              />
            );
          }
          if (cell.state === "missing") {
            return <span key={cell.ymd} title={`${cell.day}일 기록 없음`} className="h-[3px] min-w-0 flex-1 bg-border" />;
          }
          return <span key={cell.ymd} className="min-w-0 flex-1" />;
        })}
      </div>
      <div className="mt-1 flex justify-between font-[family-name:var(--font-geist-mono)] text-[10px] text-dim">
        <span>1</span>
        <span>{Math.ceil(cells.length / 2)}</span>
        <span>{cells.length}</span>
      </div>
    </section>
  );
}
