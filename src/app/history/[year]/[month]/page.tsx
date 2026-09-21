// #394 (M15-2): 월 뷰 — 7열 값 그리드 + 월 KPI + 일별 스트립.
import DayStrip from "@/components/history/DayStrip";
import HistoryNav from "@/components/history/HistoryNav";
import IntensityLegend from "@/components/history/IntensityLegend";
import KpiRow from "@/components/history/KpiRow";
import MetricPicker from "@/components/history/MetricPicker";
import MonthGrid from "@/components/history/MonthGrid";
import { historyMonthPath } from "@/lib/history/route-params";
import { loadHistoryMonthView, resolveHistoryMetric } from "@/lib/history/view";
import { resolveHistoryRoute } from "../../resolve";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ year: string; month: string }>;
  searchParams: Promise<{ metric?: string | string[] }>;
}

export default async function HistoryMonthPage({ params, searchParams }: PageProps) {
  const [segments, query] = await Promise.all([params, searchParams]);
  const { route, ctx } = await resolveHistoryRoute("month", segments);
  const metricId = resolveHistoryMetric(query.metric);
  const view = await loadHistoryMonthView(route.ym, metricId, ctx);

  return (
    <div>
      <HistoryNav route={route} today={ctx.today} lowerBound={ctx.lowerBound} metric={metricId} />
      <MetricPicker basePath={historyMonthPath(route.ym)} selected={metricId} />
      <KpiRow kpis={view.kpis} />
      <MonthGrid leadingBlanks={view.leadingBlanks} cells={view.cells} metric={view.metric} today={ctx.today} />
      <IntensityLegend metric={view.metric} />
      <DayStrip cells={view.cells} metric={view.metric} />
    </div>
  );
}
