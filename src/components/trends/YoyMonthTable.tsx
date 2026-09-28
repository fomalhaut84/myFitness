// #413: YoY 차트의 글자 · 링크 대응물 (키보드 · 스크린리더). 기본은 접혀 있다 — 시각 사용자의 화면은 그대로.
// 차트 (client · role="img") 와 달리 서버 렌더 <a> 라 Tab 으로 닿는다. `ValueTable` 톤, 폰은 가로 스크롤.
import { PARTIAL_LABELS } from "@/lib/history/trends";
import { hasAnyYoyValue, yoyCellAnnouncement, type YoyLinkRow } from "@/lib/history/yoy-links";
import { formatChartValue, type ChartMetric } from "./chart-format";

interface YoyMonthTableProps {
  rows: readonly YoyLinkRow[];
  metric: Pick<ChartMetric, "label" | "format" | "decimals" | "unit" | "aggregate">;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function YoyMonthTable({ rows, metric }: YoyMonthTableProps) {
  // 값이 하나도 없으면 (빈 차트 문구 아래 대시만 있는 표) 그리지 않는다 (사전 리뷰 info 2)
  if (!hasAnyYoyValue(rows)) return null;
  // 미완결 표시는 합계형에서만 — 차트 · Keys 문구와 같은 규칙 (info 4)
  const isSum = metric.aggregate === "sum";
  const hasPartial = isSum && rows.some((r) => r.months.some((m) => m.partial !== null));
  const hasLow = rows.some((r) => r.months.some((m) => m.lowCoverage));
  return (
    <details className="group mt-3 rounded-xl border border-border bg-card">
      <summary className="cursor-pointer list-none px-3.5 py-2 text-[12px] text-sub [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="mr-1.5 inline-block transition-transform group-open:rotate-90">▸</span>
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
                        title={isSum && cell.partial ? PARTIAL_LABELS[cell.partial] : undefined}
                        // 저커버리지는 흐림 (text-sub · 12px 대비 유지 — info 5) + sr-only 글자 (major 1)
                        className={`underline-offset-2 hover:underline focus-visible:underline ${cell.lowCoverage ? "text-sub" : "text-bright"}`}
                      >
                        {/* Tab · 링크 목록에서는 th 가 안 읽힌다 — 연 · 월 · 상태를 글자로 (사전 리뷰 major 1) */}
                        <span className="sr-only">{yoyCellAnnouncement(row.year, cell, { isSum })} </span>
                        {formatChartValue(metric, cell.value)}
                        {isSum && cell.partial ? <span aria-hidden="true">*</span> : null}
                      </a>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(hasPartial || hasLow) && (
        <p className="px-3.5 py-2 text-[11px] text-dim">
          {hasPartial ? "* = 다 채워지지 않은 달 (진행 중이거나 기록 시작일이 걸림). " : ""}
          {hasLow ? "흐린 값 = 기록이 절반 미만인 달." : ""}
        </p>
      )}
    </details>
  );
}
