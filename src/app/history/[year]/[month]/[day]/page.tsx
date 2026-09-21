// #394 (M15-2): 일 뷰 — 일간 종합 8 섹션. 캐시를 거치지 않는다 (방금 기록한 식단·체중이 바로 보여야 한다).
import DayLedger from "@/components/history/DayLedger";
import HistoryNav from "@/components/history/HistoryNav";
import { getHistoryDay } from "@/lib/history/day";
import { resolveHistoryMetric } from "@/lib/history/view";
import { resolveHistoryRoute } from "../../../resolve";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ year: string; month: string; day: string }>;
  searchParams: Promise<{ metric?: string | string[] }>;
}

export default async function HistoryDayPage({ params, searchParams }: PageProps) {
  const [segments, query] = await Promise.all([params, searchParams]);
  const { route, ctx } = await resolveHistoryRoute("day", segments);
  const day = await getHistoryDay(route.ymd);

  return (
    <div>
      {/* metric 은 일 뷰에서 쓰이지 않지만 브레드크럼으로 올라갈 때 선택을 유지하려고 실어 나른다 */}
      <HistoryNav route={route} today={ctx.today} lowerBound={ctx.lowerBound} metric={resolveHistoryMetric(query.metric)} />
      <DayLedger day={day} />
    </div>
  );
}
