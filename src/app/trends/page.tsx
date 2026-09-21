// #395 (M15-3): `/trends` 추이 분석 — 시계열 · 전년 동기 · 계절성 · 기간 비교. 상태는 전부 URL 쿼리.
// 값은 전부 summary 캐시 / 구간 롤업 경유, 피벗은 `lib/history/trends.ts` 순수 함수. 차트 컴포넌트는 그리기만 한다.
import type { ReactNode } from "react";
import { metricColor } from "@/components/history/metric-colors";
import CompareTable from "@/components/trends/CompareTable";
import ComparePeriodForm from "@/components/trends/ComparePeriodForm";
import ReadoutRow, { type Readout } from "@/components/trends/ReadoutRow";
import SeasonalityChart from "@/components/trends/SeasonalityChart";
import TrendSeriesChart from "@/components/trends/TrendSeriesChart";
import TrendsControls from "@/components/trends/TrendsControls";
import YoyChart from "@/components/trends/YoyChart";
import { aggregateCaption } from "@/components/trends/chart-format";
import { todayKSTString } from "@/lib/garmin/utils";
import type { HistoryGranularity } from "@/lib/history/buckets";
import { getCachedHistorySummary, getCachedLowerBound, getCachedRangeTotals } from "@/lib/history/cache";
import { buildCompareRows, compareMetricIds } from "@/lib/history/compare";
import { formatHistoryValue, historyDisplayUnit } from "@/lib/history/format";
import { getHistoryMetric, type HistoryMetricDef } from "@/lib/history/metrics";
import { pivotByYear, seasonality, summarizeSeries, toTrendPoints, type TrendPoint } from "@/lib/history/trends";
import {
  monthRangeLength,
  monthRangeToYmd,
  parseTrendsQuery,
  resolveTrendsRange,
  type TrendsContext,
  type TrendsQuery,
} from "@/lib/history/trends-params";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const UNIT_LABELS = { week: "주", month: "월", year: "연" } as const;
const WHOLE_LABELS = { sum: "합계", avg: "평균", max: "최고", last: "기간 말" } as const;

function Panel({ title, note, caption, children }: { title: string; note: string; caption: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card px-2.5 pb-3 pt-3.5 sm:px-[18px] sm:pt-[18px]">
      <h2 className="text-[13px] font-medium text-muted">
        {title} <span className="font-normal text-sub">{note}</span>
      </h2>
      <p className="mb-3 text-[12px] text-sub">{caption}</p>
      {children}
    </section>
  );
}

/** 그릴 값이 하나도 없을 때 — 빈 축만 보여 주지 않고 이유를 말한다. */
function EmptyChart({ message }: { message: string }) {
  return <p className="flex h-[220px] items-center justify-center px-4 text-center text-[13px] text-dim sm:h-[300px]">{message}</p>;
}

function Keys({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-0.5 text-[11px] text-sub">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function loadSummary(granularity: HistoryGranularity, range: { from: string; to: string }, def: HistoryMetricDef, ctx: TrendsContext) {
  return getCachedHistorySummary(
    { granularity, from: range.from, to: range.to, metrics: [def.id], clampedFrom: false, clampedTo: false },
    ctx,
  );
}

function pointReadout(label: string, point: TrendPoint | null, def: HistoryMetricDef): Readout {
  if (!point || point.value === null) return { label, text: null };
  return { label, text: formatHistoryValue(def, point.value), unit: historyDisplayUnit(def), caption: point.key, href: point.href };
}

async function SeriesView({ query, ctx, def, color }: ViewProps) {
  const range = resolveTrendsRange(query.range, query.unit, ctx);
  const [summary, whole] = await Promise.all([loadSummary(query.unit, range, def, ctx), getCachedRangeTotals(range, [def.id])]);
  const points = toTrendPoints(summary.buckets, def, query.unit, ctx);
  const { best, worst } = summarizeSeries(points, def);
  const unitLabel = UNIT_LABELS[query.unit];
  const wholeValue = whole.values[def.id]?.value ?? null;
  const unit = historyDisplayUnit(def);
  const isSum = def.aggregate === "sum";
  const hasLowCoverage = points.some((p) => p.lowCoverage);

  return (
    <>
      <Panel title={def.label} note={`${unitLabel} 단위${unit ? ` (${unit})` : ""}`} caption={aggregateCaption(def)}>
        {points.some((p) => p.value !== null) ? (
          <TrendSeriesChart points={points} metric={def} color={color} showBand={def.aggregate === "avg" && def.withMinMax} unitLabel={unitLabel} />
        ) : (
          <EmptyChart message="이 기간에는 기록이 없습니다. 기간을 넓히거나 다른 지표를 골라 보세요." />
        )}
        <Keys
          items={[
            ...(hasLowCoverage ? [`${isSum ? "흐린 막대" : "속 빈 점"} = 기록이 절반 미만인 ${unitLabel}`] : []),
            ...(isSum ? [`점선 막대 = 다 채워지지 않은 ${unitLabel} (진행 중이거나 기록 시작일이 걸림)`] : ["선이 끊긴 곳 = 기록 없음"]),
          ]}
        />
      </Panel>
      <ReadoutRow
        items={[
          {
            label: `기간 전체 ${WHOLE_LABELS[def.aggregate]}`,
            text: wholeValue === null ? null : formatHistoryValue(def, wholeValue),
            unit,
            caption: `${range.from.slice(0, 7)} ~ ${range.to.slice(0, 7)}`,
          },
          pointReadout(`가장 높은 ${unitLabel}`, best, def),
          pointReadout(`가장 낮은 ${unitLabel}`, worst, def),
        ]}
      />
    </>
  );
}

async function loadPivot(def: HistoryMetricDef, ctx: TrendsContext) {
  const summary = await loadSummary("month", { from: ctx.lowerBound, to: ctx.today }, def, ctx);
  return pivotByYear(summary.buckets, def, ctx);
}

async function YoyView({ ctx, def, color }: ViewProps) {
  const pivot = await loadPivot(def, ctx);
  const unit = historyDisplayUnit(def);
  const hasUsable = pivot.years.some((y) => pivot.cells[y].some((c) => c !== null && c.value !== null && !c.lowCoverage));
  return (
    <Panel
      title={def.label}
      note={`월별, 연도끼리 겹쳐 보기${unit ? ` (${unit})` : ""}`}
      caption="올해는 굵은 색 선, 지난 해는 최근일수록 밝은 회색"
    >
      {hasUsable ? (
        <YoyChart pivot={pivot} metric={def} color={color} currentYear={Number(ctx.today.slice(0, 4))} />
      ) : (
        <EmptyChart message="겹쳐 볼 달이 아직 없습니다. 기록이 절반 넘게 있는 달부터 그립니다." />
      )}
      <Keys items={def.aggregate === "sum" ? ["점선과 속 빈 점 = 다 채워지지 않은 달 (진행 중이거나 기록 시작일이 걸림)"] : ["선이 끊긴 곳 = 기록이 없거나 절반 미만인 달"]} />
    </Panel>
  );
}

const SEASON_CAPTIONS = {
  sum: "막대 = 끝난 달들의 월 합계 평균",
  avg: "굵은 선 = 그 달의 평균 (기록 일수 가중)",
  max: "굵은 선 = 그 달의 역대 최고",
  last: "굵은 선 = 그 달 값의 평균",
} as const;

async function SeasonView({ ctx, def, color }: ViewProps) {
  const months = seasonality(await loadPivot(def, ctx), def);
  const unit = historyDisplayUnit(def);
  const usable = months.filter((m) => m.value !== null);
  const high = usable.length ? usable.reduce((a, m) => ((m.value as number) > (a.value as number) ? m : a)) : null;
  const low = usable.length ? usable.reduce((a, m) => ((m.value as number) < (a.value as number) ? m : a)) : null;
  const monthReadout = (label: string, m: typeof high): Readout =>
    m === null || m.value === null
      ? { label, text: null }
      : { label, text: `${m.month}월`, caption: `${formatHistoryValue(def, m.value)}${unit ? ` ${unit}` : ""} · ${m.years}개 해` };
  // pace 는 초 차이, 그 외는 지표 표기
  const spread = high?.value != null && low?.value != null ? high.value - low.value : null;

  return (
    <>
      <Panel
        title={def.label}
        note={`몇 월에 어떤가${unit ? ` (${unit})` : ""}`}
        caption={`${SEASON_CAPTIONS[def.aggregate]}, 점 = 해마다의 값 (색 점이 올해)`}
      >
        {usable.length > 0 ? (
          <SeasonalityChart months={months} metric={def} color={color} currentYear={Number(ctx.today.slice(0, 4))} />
        ) : (
          <EmptyChart message="계절성을 볼 달이 아직 없습니다. 기록이 절반 넘게 있는, 끝난 달만 셉니다." />
        )}
      </Panel>
      <ReadoutRow
        items={[
          monthReadout("가장 높은 달", high),
          monthReadout("가장 낮은 달", low),
          {
            label: "높낮이 차",
            text: spread === null ? null : def.format === "pace" ? `${Math.round(spread)}초` : formatHistoryValue(def, spread),
            unit: def.format === "pace" ? "" : unit,
          },
        ]}
      />
    </>
  );
}

async function CompareView({ query, ctx, def, color }: ViewProps) {
  const ids = compareMetricIds(def.id);
  const [a, b] = await Promise.all([
    getCachedRangeTotals(monthRangeToYmd(query.a, ctx), ids),
    getCachedRangeTotals(monthRangeToYmd(query.b, ctx), ids),
  ]);
  const monthsA = monthRangeLength(query.a);
  const monthsB = monthRangeLength(query.b);
  const rows = buildCompareRows(
    { values: a.values, months: monthsA, totalDays: a.totalDays },
    { values: b.values, months: monthsB, totalDays: b.totalDays },
    def.id,
  );
  return (
    <>
      <ComparePeriodForm query={query} ctx={ctx} color={color} />
      <CompareTable rows={rows} color={color} lengthsDiffer={monthsA !== monthsB} />
    </>
  );
}

interface ViewProps {
  query: TrendsQuery;
  ctx: TrendsContext;
  def: HistoryMetricDef;
  color: string;
}

const VIEW_COMPONENTS = { series: SeriesView, yoy: YoyView, season: SeasonView, compare: CompareView } as const;

export default async function TrendsPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const ctx: TrendsContext = { today: todayKSTString(), lowerBound: await getCachedLowerBound() };
  const query = parseTrendsQuery(raw, ctx);
  const def = getHistoryMetric(query.metric);
  const color = metricColor(def.id);
  const View = VIEW_COMPONENTS[query.view];

  return (
    <div>
      <TrendsControls query={query} ctx={ctx} color={color} />
      <View query={query} ctx={ctx} def={def} color={color} />
    </div>
  );
}
