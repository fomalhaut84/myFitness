"use client";

// #395 (M15-3): 시계열. 합계형 = 막대, 그 외 = 선 (+ min~max 띠). 받은 배열을 그리기만 한다 — 가공은 `lib/history/trends.ts`.
//
// X 축은 카테고리 (버킷 키). 버킷이 빈 것까지 연속으로 오므로 등간격 = 실제 시간 간격이라 `scale="time"` 이 필요 없다.
// Y domain 은 데이터를 따르게 둔다 (`allowDataOverflow` 기본값 유지 — 클리핑은 데이터를 숨기는 것).
import { Area, Bar, Cell, ComposedChart, CartesianGrid, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PARTIAL_LABELS, type TrendPoint } from "@/lib/history/trends";
import {
  CHART_AXIS_TICK,
  CHART_GRID_STROKE,
  CHART_TOOLTIP_CLASS,
  formatAxisValue,
  formatChartValue,
  type ChartMetric,
} from "./chart-format";

interface TrendSeriesChartProps {
  points: readonly TrendPoint[];
  metric: ChartMetric;
  color: string;
  /** min~max 띠 표시 (avg + withMinMax 지표) */
  showBand: boolean;
  unitLabel: string;
}

interface Row extends TrendPoint {
  band: [number, number] | null;
}

const MAX_X_LABELS = 14;
const DOT_LIMIT = 40;
const BAR_OPACITY = { normal: 0.85, partial: 0.35, low: 0.28 } as const;

function pickTicks(points: readonly TrendPoint[]): string[] {
  const every = Math.max(1, Math.ceil(points.length / MAX_X_LABELS));
  const half = Math.floor(every / 2);
  return points.flatMap((p, i) => {
    if (p.yearStart) return [p.key];
    if (i % every !== 0) return [];
    const nearYear = points.slice(Math.max(0, i - half), i + half + 1).some((q) => q.yearStart);
    return nearYear ? [] : [p.key];
  });
}

export default function TrendSeriesChart({ points, metric, color, showBand, unitLabel }: TrendSeriesChartProps) {
  const rows: Row[] = points.map((p) => ({ ...p, band: p.min !== null && p.max !== null ? [p.min, p.max] : null }));
  const byKey = new Map(points.map((p) => [p.key, p]));
  const isBar = metric.aggregate === "sum";
  const showDots = points.length <= DOT_LIMIT;

  return (
    <div className="h-[220px] sm:h-[300px]" role="img" aria-label={`${metric.label} ${unitLabel} 단위 시계열`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART_GRID_STROKE} />
          <XAxis
            dataKey="key"
            ticks={pickTicks(points)}
            interval={0}
            axisLine={false}
            tickLine={false}
            tick={({ x, y, payload }) => {
              const key = String(payload.value);
              const p = byKey.get(key);
              const year = p?.yearStart ?? false;
              return (
                <text x={x} y={Number(y) + 12} textAnchor="middle" fontSize={10} fill={year ? "#a3a3a3" : "#525252"}>
                  {year ? key.slice(0, 4) : p?.label}
                </text>
              );
            }}
          />
          <YAxis
            width={40}
            axisLine={false}
            tickLine={false}
            tick={CHART_AXIS_TICK}
            domain={isBar ? [0, "auto"] : ["auto", "auto"]}
            reversed={metric.format === "pace"}
            tickFormatter={(v) => formatAxisValue(metric, v)}
          />
          {points.filter((p) => p.yearStart).map((p) => (
            <ReferenceLine key={p.key} x={p.key} stroke="#2a2a2a" strokeDasharray="2 3" />
          ))}
          <Tooltip
            cursor={{ fill: "#ffffff", fillOpacity: 0.04, stroke: "#333333" }}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
              if (!p) return null;
              return (
                <div className={CHART_TOOLTIP_CLASS}>
                  <div className="font-[family-name:var(--font-geist-mono)] text-sub">{p.key}</div>
                  <div className="text-[13px] text-bright">{formatChartValue(metric, p.value)}</div>
                  {p.band && (
                    <div>
                      최저 {formatChartValue(metric, p.band[0])} · 최고 {formatChartValue(metric, p.band[1])}
                    </div>
                  )}
                  {!metric.missingAsZero && (
                    <div>
                      {p.coveredDays}/{p.totalDays}일 기록{p.lowCoverage ? " (절반 미만)" : ""}
                    </div>
                  )}
                  {p.partial && isBar && <div>{PARTIAL_LABELS[p.partial]} (부분 합계)</div>}
                </div>
              );
            }}
          />
          {showBand && <Area dataKey="band" stroke="none" fill={color} fillOpacity={0.13} connectNulls={false} isAnimationActive={false} />}
          {isBar ? (
            <Bar dataKey="value" radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {rows.map((p) => (
                <Cell
                  key={p.key}
                  fill={color}
                  fillOpacity={p.lowCoverage ? BAR_OPACITY.low : p.partial ? BAR_OPACITY.partial : BAR_OPACITY.normal}
                  stroke={p.partial && !p.lowCoverage ? color : undefined}
                  strokeDasharray={p.partial && !p.lowCoverage ? "3 2" : undefined}
                />
              ))}
            </Bar>
          ) : (
            <Line
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              connectNulls={false}
              isAnimationActive={false}
              activeDot={{ r: 4 }}
              dot={({ cx, cy, payload, index }: { cx?: number; cy?: number; payload: Row; index: number }) => {
                if (cx === undefined || cy === undefined || payload.value === null) return <g key={index} />;
                if (payload.lowCoverage) return <circle key={index} cx={cx} cy={cy} r={3.5} fill="#161616" stroke={color} strokeWidth={1.5} />;
                return showDots ? <circle key={index} cx={cx} cy={cy} r={2.2} fill={color} /> : <g key={index} />;
              }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
