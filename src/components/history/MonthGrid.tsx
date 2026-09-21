// #394 (M15-2): 월 그리드 — 7열 (일~토), 셀 = 날짜 + 선택 지표 값 + 색 강도. 360px 에서도 7열 유지.
//
// `MonthlyHeatmap` (lifestyle) 을 일반화하지 않고 신설했다: 그쪽은 로컬 TZ Date 로 달력을 만들고 이진값만 받는다.
// 여기는 ymd 기반 (`monthCells`) + 값·강도. 셀의 세 상태: 값 / 0 (쉰 날 — 채워진 빈칸) / 기록 없음 (뚫린 칸).
import Link from "next/link";
import { formatHistoryCellValue, formatHistoryValue } from "@/lib/history/format";
import type { HistoryMetricDef } from "@/lib/history/metrics";
import { historyDayPath, historyMetricQuery } from "@/lib/history/route-params";
import type { HistoryDayCell } from "@/lib/history/view";
import { HOT_LEVEL, intensityBackground, metricColor } from "./metric-colors";

interface MonthGridProps {
  leadingBlanks: number;
  cells: readonly HistoryDayCell[];
  metric: HistoryMetricDef;
  today: string;
}

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const CELL_BASE =
  "relative flex aspect-square min-w-0 items-end justify-center rounded-md pb-[16%] sm:rounded-lg lg:aspect-[1.55] lg:items-center lg:pb-0";
const DATE_BASE = "absolute left-1 top-[3px] text-[9px] sm:left-[7px] sm:top-[5px] sm:text-[10px]";
const VALUE_BASE = "font-[family-name:var(--font-geist-mono)] text-[11px] font-medium sm:text-[13px] lg:text-[15px]";

function Cell({ cell, metric, isToday }: { cell: HistoryDayCell; metric: HistoryMetricDef; isToday: boolean }) {
  if (cell.state === "off") {
    return (
      <div className={CELL_BASE}>
        <span className={`${DATE_BASE} text-[#333]`}>{cell.day}</span>
      </div>
    );
  }
  const ring = isToday ? { boxShadow: `inset 0 0 0 1.5px ${metricColor(metric.id)}` } : undefined;
  const href = `${historyDayPath(cell.ymd)}${historyMetricQuery(metric.id)}`;

  if (cell.state === "missing") {
    return (
      <Link
        href={href}
        aria-label={`${cell.day}일 기록 없음`}
        className={`${CELL_BASE} shadow-[inset_0_0_0_1px_#1f1f1f] hover:shadow-[inset_0_0_0_1px_var(--border-hover)]`}
        style={ring}
      >
        <span className={`${DATE_BASE} text-sub`}>{cell.day}</span>
        <span className="text-[10px] text-dim">없음</span>
      </Link>
    );
  }
  if (cell.state === "zero" || cell.value === null || cell.level === null) {
    return (
      <Link
        href={href}
        aria-label={`${cell.day}일 0${metric.unit}`}
        className={`${CELL_BASE} bg-card hover:bg-card-hover`}
        style={ring}
      >
        <span className={`${DATE_BASE} text-sub`}>{cell.day}</span>
        <span className={`${VALUE_BASE} text-dim`}>·</span>
      </Link>
    );
  }
  const hot = cell.level >= HOT_LEVEL;
  return (
    <Link
      href={href}
      aria-label={`${cell.day}일 ${formatHistoryValue(metric, cell.value)}${metric.unit}`}
      className={`${CELL_BASE} hover:brightness-110`}
      style={{ background: intensityBackground(metric.id, cell.level), ...ring }}
    >
      <span className={`${DATE_BASE} ${hot ? "text-white/70" : "text-sub"}`}>{cell.day}</span>
      <span className={`${VALUE_BASE} text-bright`}>{formatHistoryCellValue(metric, cell.value)}</span>
    </Link>
  );
}

export default function MonthGrid({ leadingBlanks, cells, metric, today }: MonthGridProps) {
  return (
    <div>
      <div className="mb-1.5 grid grid-cols-7 gap-[3px] text-center text-[11px] text-dim sm:gap-1">
        {DAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-[3px] sm:gap-1">
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <div key={`b${i}`} />
        ))}
        {cells.map((cell) => (
          <Cell key={cell.ymd} cell={cell} metric={metric} isToday={cell.ymd === today} />
        ))}
      </div>
    </div>
  );
}
