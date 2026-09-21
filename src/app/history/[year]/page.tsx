// #394 (M15-2): 연 뷰 — 12개월 카드 (미니 달력) + 연 KPI + 지표 선택.
import HistoryNav from "@/components/history/HistoryNav";
import IntensityLegend from "@/components/history/IntensityLegend";
import KpiRow from "@/components/history/KpiRow";
import MetricPicker from "@/components/history/MetricPicker";
import YearMonthCard from "@/components/history/YearMonthCard";
import { historyMetricQuery, historyYearPath } from "@/lib/history/route-params";
import { loadHistoryYearView, resolveHistoryMetric } from "@/lib/history/view";
import { resolveHistoryRoute } from "../resolve";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ year: string }>;
  searchParams: Promise<{ metric?: string | string[] }>;
}

export default async function HistoryYearPage({ params, searchParams }: PageProps) {
  const [segments, query] = await Promise.all([params, searchParams]);
  const { route, ctx } = await resolveHistoryRoute("year", segments);
  const metricId = resolveHistoryMetric(query.metric);
  const view = await loadHistoryYearView(route.year, metricId, ctx);

  return (
    <div>
      <HistoryNav route={route} today={ctx.today} lowerBound={ctx.lowerBound} metric={metricId} />
      <MetricPicker hrefFor={(id) => `${historyYearPath(route.year)}${historyMetricQuery(id)}`} selected={metricId} />
      <KpiRow kpis={view.kpis} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
        {view.months.map((summary) => (
          <YearMonthCard key={summary.ym} summary={summary} metric={view.metric} />
        ))}
      </div>
      <IntensityLegend metric={view.metric} />
    </div>
  );
}
