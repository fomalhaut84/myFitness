"use client";

// #395 (M15-3): 계절성 — 월별 대표값 (합계형 막대 / 그 외 굵은 가로선) 위에 해마다의 점. 올해 점만 지표색.
// 12개 막대만 두면 평균 뒤의 편차가 안 보인다. 점은 선 없는 Line (연도별) 으로 그린다 — 카테고리 축에서 가장 안정적.
import { useRouter } from "next/navigation";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { historyMetricQuery, historyMonthPath } from "@/lib/history/route-params";
import type { SeasonalityMonth } from "@/lib/history/trends";
import {
  CHART_AXIS_TICK,
  CHART_GRID_STROKE,
  CHART_TOOLTIP_CLASS,
  formatAxisValue,
  formatChartValue,
  type ChartMetric,
} from "./chart-format";

interface SeasonalityChartProps {
  months: readonly SeasonalityMonth[];
  metric: ChartMetric;
  color: string;
  currentYear: number;
}

type Row = { month: number; value: number | null; years: number } & Record<string, number | null>;

export default function SeasonalityChart({ months, metric, color, currentYear }: SeasonalityChartProps) {
  const router = useRouter();
  const isSum = metric.aggregate === "sum";
  const years = [...new Set(months.flatMap((m) => m.points.map((p) => p.year)))].sort((a, b) => a - b);
  const rows: Row[] = months.map((m) => {
    const row: Row = { month: m.month, value: m.value, years: m.years };
    for (const year of years) row[`y${year}`] = m.points.find((p) => p.year === year)?.value ?? null;
    return row;
  });

  return (
    <div className="h-[220px] sm:h-[300px]" role="img" aria-label={`${metric.label} 계절성`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART_GRID_STROKE} />
          <XAxis dataKey="month" axisLine={false} tickLine={false} tick={CHART_AXIS_TICK} interval={0} tickFormatter={(m) => `${m}월`} />
          <YAxis
            width={40}
            axisLine={false}
            tickLine={false}
            tick={CHART_AXIS_TICK}
            domain={isSum ? [0, "auto"] : ["auto", "auto"]}
            reversed={metric.format === "pace"}
            tickFormatter={(v) => formatAxisValue(metric, v)}
          />
          <Tooltip
            cursor={{ fill: "#ffffff", fillOpacity: 0.04, pointerEvents: "none" }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
              if (!row) return null;
              return (
                <div className={CHART_TOOLTIP_CLASS}>
                  <div className="text-sub">
                    {row.month}월 · {row.years}개 해
                  </div>
                  <div className="text-[13px] text-bright">{formatChartValue(metric, row.value)}</div>
                  {[...years].reverse().flatMap((year) => {
                    const v = row[`y${year}`];
                    return v === null || v === undefined
                      ? []
                      : [
                          <div key={year} className="flex justify-between gap-4 font-[family-name:var(--font-geist-mono)]">
                            <span style={{ color: year === currentYear ? color : undefined }}>{year}</span>
                            <span>{formatChartValue(metric, v)}</span>
                          </div>,
                        ];
                  })}
                </div>
              );
            }}
          />
          <Bar
            dataKey="value"
            isAnimationActive={false}
            // Recharts 는 custom shape 가 있으면 값 없는 막대를 걸러내지 않고, 축 스케일은 null 을 0 으로 읽는다 →
            // 결측 달에 "값 0" 위치로 가로선이 그려진다 (사전 리뷰 major 2). 값부터 확인한다.
            shape={({ x, y, width, height, payload }: { x?: number; y?: number; width?: number; height?: number; payload?: Row }) => {
              if (typeof payload?.value !== "number") return <g />;
              if (x === undefined || y === undefined || width === undefined || height === undefined) return <g />;
              const inset = width * 0.2;
              return isSum ? (
                <rect x={x + inset} y={y} width={width - inset * 2} height={Math.max(0, height)} rx={3} fill={color} fillOpacity={0.8} />
              ) : (
                <line x1={x + inset} x2={x + width - inset} y1={y} y2={y} stroke={color} strokeWidth={3} strokeLinecap="round" />
              );
            }}
          />
          {years.map((year) => (
            <Line
              key={year}
              dataKey={`y${year}`}
              stroke="none"
              strokeWidth={0}
              isAnimationActive={false}
              activeDot={false}
              // #396: 해마다의 점 클릭 → 그 연도 · 달의 월 뷰
              dot={({ cx, cy, payload, index }: { cx?: number; cy?: number; payload?: Row; index: number }) =>
                cx === undefined || cy === undefined || !payload || typeof payload[`y${year}`] !== "number" ? (
                  <g key={index} />
                ) : (
                  <circle
                    key={index}
                    cx={cx}
                    cy={cy}
                    r={2.6}
                    fill={year === currentYear ? color : "#8f8f8f"}
                    fillOpacity={year === currentYear ? 1 : 0.55}
                    style={{ cursor: "pointer" }}
                    onClick={() => router.push(`${historyMonthPath(`${year}-${String(payload.month).padStart(2, "0")}`)}${historyMetricQuery(metric.id)}`)}
                  />
                )
              }
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
