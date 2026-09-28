// #394 (M15-2): 연·월 KPI 7종. 카드 7장이 아니라 한 줄의 판독값 띠 — 모바일은 가로 스크롤 한 줄
// (세로로 쌓으면 달력이 첫 화면 밖으로 밀린다).
import type { HistoryKpi } from "@/lib/history/kpi";

interface KpiRowProps {
  kpis: readonly HistoryKpi[];
}

export default function KpiRow({ kpis }: KpiRowProps) {
  return (
    <dl className="mb-6 flex overflow-x-auto rounded-xl border border-border bg-card [scrollbar-width:none] lg:grid lg:grid-cols-7">
      {kpis.map((kpi, i) => (
        <div
          key={kpi.key}
          className={`min-w-[112px] flex-none px-3.5 py-3 lg:min-w-0 ${i > 0 ? "border-l border-border" : ""}`}
        >
          <dt className="whitespace-nowrap text-[11px] text-sub">{kpi.label}</dt>
          {kpi.text === null ? (
            <dd className="pt-1 text-[13px] text-dim">기록 없음</dd>
          ) : (
            <dd className="mt-0.5 whitespace-nowrap font-[family-name:var(--font-geist-mono)] text-[17px] font-medium text-bright">
              {kpi.text}
              {kpi.unit && <span className="ml-1 text-[11px] font-normal text-sub">{kpi.unit}</span>}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}
