// #394 (M15-2): 연 뷰 월 카드 — 그 달의 실제 달력을 작게 넣는다 (12개월 밀착 인화).
// 미니 달력은 aria-hidden: 카드의 숫자·커버리지가 같은 정보를 글자로 준다.
import Link from "next/link";
import { formatHistoryValue, historyDisplayUnit } from "@/lib/history/format";
import type { HistoryMetricDef } from "@/lib/history/metrics";
import { historyMetricQuery, historyMonthPath } from "@/lib/history/route-params";
import type { HistoryDayCell, HistoryMonthSummary } from "@/lib/history/view";
import { intensityBackground } from "./metric-colors";

interface YearMonthCardProps {
  summary: HistoryMonthSummary;
  metric: HistoryMetricDef;
}

function MiniCell({ cell, metric }: { cell: HistoryDayCell; metric: HistoryMetricDef }) {
  if (cell.state === "off") return <span className="aspect-square" />;
  if (cell.state === "missing") return <span className="aspect-square rounded-[3px] shadow-[inset_0_0_0_1px_#242424]" />;
  if (cell.state === "zero" || cell.level === null) return <span className="aspect-square rounded-[3px] bg-surface" />;
  return <span className="aspect-square rounded-[3px]" style={{ background: intensityBackground(metric.id, cell.level) }} />;
}

const DEFAULT_ACTIVITY_COVERAGE_NOUN = "달림";

/** 활동 지표는 "N일 달림" — 값이 있는 활동만 세는 지표 (2분 HRR) 는 정의의 `coverageNoun` (PR #447 Codex P2) */
export function coverageText(summary: Pick<HistoryMonthSummary, "coveredDays" | "totalDays">, metric: Pick<HistoryMetricDef, "source" | "coverageNoun">): string {
  return metric.source === "activity"
    ? `${summary.coveredDays}일 ${metric.coverageNoun ?? DEFAULT_ACTIVITY_COVERAGE_NOUN}`
    : `${summary.coveredDays}/${summary.totalDays}일 기록`;
}

export default function YearMonthCard({ summary, metric }: YearMonthCardProps) {
  const unit = historyDisplayUnit(metric);
  const body = (
    <>
      <div className="sm:mb-2.5 sm:flex sm:items-baseline sm:justify-between">
        <span className="block text-[14px] font-medium text-bright">{summary.month}월</span>
        {summary.live &&
          (summary.value === null ? (
            <span className="block text-[12px] text-dim">기록 없음</span>
          ) : (
            <span className="mt-0.5 block font-[family-name:var(--font-geist-mono)] text-[17px] font-medium text-bright sm:mt-0 sm:text-[14px]">
              {formatHistoryValue(metric, summary.value)}
              {unit && <span className="ml-0.5 text-[11px] font-normal text-sub">{unit}</span>}
            </span>
          ))}
      </div>
      <div aria-hidden className="col-start-2 row-span-2 row-start-1 grid grid-cols-7 gap-0.5 sm:gap-[3px]">
        {Array.from({ length: summary.leadingBlanks }, (_, i) => (
          <span key={`b${i}`} className="aspect-square" />
        ))}
        {summary.cells.map((cell) => (
          <MiniCell key={cell.ymd} cell={cell} metric={metric} />
        ))}
      </div>
      <p className="text-[11px] text-dim sm:mt-2">{summary.live ? coverageText(summary, metric) : ""}</p>
    </>
  );
  // 모바일: 왼쪽 값 · 오른쪽 미니 달력 (세로 스택). sm 이상: 위 헤더 · 아래 달력
  const layout = "grid grid-cols-[1fr_112px] items-center gap-x-3 rounded-xl border border-border bg-card px-3.5 py-3 sm:block sm:p-3.5";
  if (!summary.live) return <div className={`${layout} opacity-35`}>{body}</div>;
  return (
    <Link
      href={`${historyMonthPath(summary.ym)}${historyMetricQuery(metric.id)}`}
      className={`${layout} transition-colors hover:border-border-hover hover:bg-card-hover`}
    >
      {body}
    </Link>
  );
}
