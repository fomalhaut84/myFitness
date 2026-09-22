"use client";

// #395 (M15-3): 시계열. 합계형 = 막대, 그 외 = 선 (+ min~max 띠). 받은 배열을 그리기만 한다 — 가공은 `lib/history/trends.ts`.
//
// X 축은 카테고리 (버킷 키). 버킷이 빈 것까지 연속으로 오므로 등간격 = 실제 시간 간격이라 `scale="time"` 이 필요 없다.
// Y domain 은 데이터를 따르게 둔다 (`allowDataOverflow` 기본값 유지 — 클리핑은 데이터를 숨기는 것).
import { useRouter } from "next/navigation";
import { Area, Bar, Cell, ComposedChart, CartesianGrid, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EVENT_KIND_LABELS, type ChartMarkers } from "@/lib/history/markers";
import { PARTIAL_LABELS, type TrendPoint } from "@/lib/history/trends";
import { MARKER_COLORS, PLAN_BAND_OPACITY } from "./MarkerGlyph";
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
  /** #396: 이벤트 마커 (레이스 · 지표 변경 = 세로선, 플랜 = 밴드). 없으면 안 그린다 */
  markers?: ChartMarkers;
  /** #396: 포인트 클릭 목적지 라벨 (`월 뷰` · `연 뷰`) — 툴팁 마지막 줄 */
  clickTarget: string;
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

export default function TrendSeriesChart({ points, metric, color, showBand, unitLabel, markers, clickTarget }: TrendSeriesChartProps) {
  const router = useRouter();
  const rows: Row[] = points.map((p) => ({ ...p, band: p.min !== null && p.max !== null ? [p.min, p.max] : null }));
  const byKey = new Map(points.map((p) => [p.key, p]));
  const markersByKey = new Map((markers?.lines ?? []).map((l) => [l.key, l]));
  const isBar = metric.aggregate === "sum";
  const showDots = points.length <= DOT_LIMIT;
  // #396: 포인트 클릭 → `/history`. 툴팁은 포인터를 따라다녀 링크를 못 넣으므로 막대 · 점 자체가 링크 역할.
  const go = (row: Row | undefined) => {
    if (row?.href) router.push(row.href);
  };

  return (
    <div className="h-[220px] sm:h-[300px]" role="img" aria-label={`${metric.label} ${unitLabel} 단위 시계열`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: markers ? 14 : 8, right: 8, bottom: 0, left: 0 }} style={{ cursor: "pointer" }}>
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
            <ReferenceLine key={p.key} x={p.key} stroke="#2a2a2a" strokeDasharray="2 3" pointerEvents="none" />
          ))}
          {/* #396: 플랜 밴드는 데이터 아래 (막대 색이 탁해지지 않게), 마커 선은 데이터 위 — 렌더 순서로 층을 나눈다 */}
          {markers?.bands.map((b) => (
            <ReferenceArea key={`band-${b.fromKey}-${b.event.title}`} x1={b.fromKey} x2={b.toKey} fill={MARKER_COLORS.plan} fillOpacity={PLAN_BAND_OPACITY} stroke="none" pointerEvents="none" />
          ))}
          <Tooltip
            // #396: 커서 (컬럼 하이라이트) 가 막대 · 점 위에 그려져 클릭을 가로챈다 — 포인터 이벤트를 끈다
            cursor={{ fill: "#ffffff", fillOpacity: 0.04, stroke: "#333333", pointerEvents: "none" }}
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
                  {markersByKey.get(p.key)?.events.map((e) => (
                    <div key={`${e.kind}-${e.ymd}-${e.title}`} className="text-muted">
                      {EVENT_KIND_LABELS[e.kind]} · {e.title}
                    </div>
                  ))}
                  <div className="text-dim">클릭 → {clickTarget}</div>
                </div>
              );
            }}
          />
          {showBand && <Area dataKey="band" stroke="none" fill={color} fillOpacity={0.13} connectNulls={false} isAnimationActive={false} />}
          {isBar ? (
            <Bar dataKey="value" radius={[2, 2, 0, 0]} isAnimationActive={false} onClick={(data) => go((data as { payload?: Row }).payload)}>
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
              activeDot={({ cx, cy, payload }: { cx?: number; cy?: number; payload?: Row }) =>
                cx === undefined || cy === undefined ? <g /> : <circle cx={cx} cy={cy} r={4} fill={color} onClick={() => go(payload)} />
              }
              dot={({ cx, cy, payload, index }: { cx?: number; cy?: number; payload: Row; index: number }) => {
                if (cx === undefined || cy === undefined || payload.value === null) return <g key={index} />;
                if (payload.lowCoverage)
                  return <circle key={index} cx={cx} cy={cy} r={3.5} fill="#161616" stroke={color} strokeWidth={1.5} onClick={() => go(payload)} />;
                return showDots ? <circle key={index} cx={cx} cy={cy} r={2.2} fill={color} onClick={() => go(payload)} /> : <g key={index} />;
              }}
            />
          )}
          {markers?.lines.map((l) => (
            <ReferenceLine
              key={`mark-${l.key}`}
              x={l.key}
              stroke={l.race ? MARKER_COLORS.race : MARKER_COLORS.metric}
              strokeWidth={l.race ? 1.5 : 1}
              strokeDasharray={l.race ? undefined : "3 3"}
              // 마커 선은 막대 위에 그려진다 — 포인터 이벤트를 끄지 않으면 마커가 있는 버킷은 클릭이 안 된다
              pointerEvents="none"
              label={
                l.label
                  ? ({ viewBox }: { viewBox?: { x?: number; y?: number } }) =>
                      viewBox?.x === undefined || viewBox.y === undefined ? null : (
                        <text
                          x={viewBox.x}
                          y={viewBox.y - 4}
                          textAnchor="middle"
                          fontSize={9}
                          fontWeight={500}
                          fill={l.race ? MARKER_COLORS.race : MARKER_COLORS.metric}
                          className="hidden font-[family-name:var(--font-geist-mono)] sm:inline"
                        >
                          {l.label}
                        </text>
                      )
                  : undefined
              }
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
