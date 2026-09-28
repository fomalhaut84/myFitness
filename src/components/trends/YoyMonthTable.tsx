// #413: YoY 차트의 글자 · 링크 대응물 (키보드 · 스크린리더). 기본은 접혀 있다 — 시각 사용자의 화면은 그대로.
// 차트 (client · role="img") 와 달리 서버 렌더 <a> 라 Tab 으로 닿는다. `ValueTable` 톤, 폰은 가로 스크롤.
import { PARTIAL_LABELS } from "@/lib/history/trends";
import type { YoyLinkRow } from "@/lib/history/yoy-links";
import { formatChartValue, type ChartMetric } from "./chart-format";

interface YoyMonthTableProps {
  rows: readonly YoyLinkRow[];
  metric: Pick<ChartMetric, "label" | "format" | "decimals" | "unit">;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function YoyMonthTable({ rows, metric }: YoyMonthTableProps) {
  if (rows.length === 0) return null;
  const hasPartial = rows.some((r) => r.months.some((m) => m.partial !== null));
  return (
    <details className="group mt-3 rounded-xl border border-border bg-card">
      <summary className="cursor-pointer list-none px-3.5 py-2 text-[12px] text-sub [&::-webkit-details-marker]:hidden">
        <span className="mr-1.5 inline-block transition-transform group-open:rotate-90">▸</span>
        월별 값 · 링크 <span className="text-dim">(키보드 · 스크린리더 — 칸을 열면 그 달의 기록)</span>
      </summary>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full border-collapse" aria-label={`${metric.label} 연도별 월 값`}>
          <thead>
            <tr className="text-[12px] font-medium text-sub">
              <th scope="col" className="px-2.5 py-1.5 text-left font-medium">
                해
              </th>
              {MONTHS.map((m) => (
                <th key={m} scope="col" className="whitespace-nowrap px-2 py-1.5 text-right font-medium">
                  {m}월
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.year} className="border-t border-border">
                <th scope="row" className="whitespace-nowrap px-2.5 py-1.5 text-left font-[family-name:var(--font-geist-mono)] text-[12px] font-normal text-muted">
                  {row.year}
                </th>
                {row.months.map((cell) => (
                  <td key={cell.month} className="whitespace-nowrap px-2 py-1.5 text-right font-[family-name:var(--font-geist-mono)] text-[12px]">
                    {cell.href === null || cell.value === null ? (
                      <span className="text-dim">—</span>
                    ) : (
                      <a
                        href={cell.href}
                        title={cell.partial ? PARTIAL_LABELS[cell.partial] : undefined}
                        className={`underline-offset-2 hover:underline focus-visible:underline ${cell.lowCoverage ? "text-dim" : "text-bright"}`}
                      >
                        {formatChartValue(metric, cell.value)}
                        {cell.partial ? "*" : ""}
                      </a>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasPartial && <p className="px-3.5 py-2 text-[11px] text-dim">* = 다 채워지지 않은 달 (진행 중이거나 기록 시작일이 걸림). 흐린 값 = 기록이 절반 미만인 달.</p>}
    </details>
  );
}
