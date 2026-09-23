"use client";

// #397: 산점도 공통 — 계열 (연도 또는 습도 단) × 점. 계열 토글은 client state (URL 에 넣지 않음, YoY 규칙).
// 점 클릭 → 활동 상세. 정적 점 자체에 onClick (#396 교훈) · 툴팁 커서는 pointer-events none.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_TOOLTIP_CLASS } from "@/components/trends/chart-format";
import { formatAxis, type AxisFormat } from "./scatter-format";

export interface ScatterPoint {
  x: number;
  y: number;
  /** 툴팁 줄 (첫 줄이 제목) */
  lines: readonly string[];
  href: string | null;
  /** 이 계열의 토글이 아니라 다른 계열의 토글을 따르는 점 (레이스 점 → 연도) */
  toggleId?: string;
}

export interface ScatterSeries {
  id: string;
  label: string;
  color: string;
  /** 속 빈 점 (레이스) */
  hollow?: boolean;
  /** #425: 강조 계열 — 큰 속 빈 점 (연도 중앙값). 이 패널의 굵은 표현 하나 */
  emphasis?: boolean;
  points: readonly ScatterPoint[];
}

export interface ScatterAxis {
  label: string;
  reversed?: boolean;
  /** 서버 → 클라이언트 경계를 넘으므로 함수가 아니라 이름 */
  format: AxisFormat;
  /** #425: 명시 눈금 (시간 축 — 정수 연도만) */
  ticks?: readonly number[];
  /** #425: 명시 도메인 — 시간 축은 [첫 해, 마지막 해 + 1] (한 해뿐이면 자동 도메인이 너무 좁다) */
  domain?: readonly [number, number];
  /** #425: 0 기준선 (음수 = 종료 뒤 심박 상승을 숨기지 않는다) */
  zeroLine?: boolean;
}

interface InsightScatterProps {
  series: readonly ScatterSeries[];
  x: ScatterAxis;
  y: ScatterAxis;
  ariaLabel: string;
  /** 토글 버튼을 보일지 (연도 계열) — 습도 계열은 범례만 */
  toggle: boolean;
}

/** 점 반지름 — 폰 2 · 데스크톱 2.4 (CSS `r` 로, 속성은 폴백) */
const DOT_R = 2.4;
const DOT_CLASS = "[r:2px] sm:[r:2.4px]";
const HOLLOW_CLASS = "[r:3px] sm:[r:3.4px]";
const EMPHASIS_R = 6;

export default function InsightScatter({ series, x, y, ariaLabel, toggle }: InsightScatterProps) {
  const router = useRouter();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const visible = series
    .filter((s) => !hidden.has(s.id))
    .map((s) => ({ ...s, points: s.points.filter((p) => p.toggleId === undefined || !hidden.has(p.toggleId)) }));

  function flip(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div className="h-[220px] sm:h-[320px]" role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 10, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={CHART_GRID_STROKE} />
            <XAxis
              dataKey="x"
              type="number"
              domain={x.domain ? [...x.domain] : ["auto", "auto"]}
              ticks={x.ticks ? [...x.ticks] : undefined}
              reversed={x.reversed}
              axisLine={false}
              tickLine={false}
              tick={CHART_AXIS_TICK}
              tickFormatter={(v) => formatAxis(x.format, v)}
              label={{ value: x.label, position: "insideBottomRight", offset: -2, fontSize: 10, fill: "#737373" }}
            />
            <YAxis
              dataKey="y"
              type="number"
              width={44}
              domain={["auto", "auto"]}
              reversed={y.reversed}
              axisLine={false}
              tickLine={false}
              tick={CHART_AXIS_TICK}
              tickFormatter={(v) => formatAxis(y.format, v)}
              label={{ value: y.label, position: "insideTopLeft", offset: 0, fontSize: 10, fill: "#737373" }}
            />
            <Tooltip
              cursor={{ stroke: "#333333", strokeDasharray: "2 3", pointerEvents: "none" }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as ScatterPoint | undefined) : undefined;
                if (!p) return null;
                return (
                  <div className={CHART_TOOLTIP_CLASS}>
                    {p.lines.map((line, i) => (
                      <div key={i} className={i === 0 ? "font-[family-name:var(--font-geist-mono)] text-sub" : "text-bright"}>
                        {line}
                      </div>
                    ))}
                    {p.href && <div className="text-dim">클릭 → 활동</div>}
                  </div>
                );
              }}
            />
            {y.zeroLine && <ReferenceLine y={0} stroke="#333333" pointerEvents="none" />}
            {visible.map((s) => (
              <Scatter
                key={s.id}
                name={s.label}
                data={s.points as ScatterPoint[]}
                fill={s.color}
                isAnimationActive={false}
                shape={({ cx, cy, payload }: { cx?: number; cy?: number; payload?: ScatterPoint }) => {
                  if (cx === undefined || cy === undefined || !payload) return <g />;
                  const go = () => {
                    if (payload.href) router.push(payload.href);
                  };
                  const cursor = payload.href ? "pointer" : "default";
                  if (s.emphasis) return <circle cx={cx} cy={cy} r={EMPHASIS_R} fill="#161616" stroke={s.color} strokeWidth={1.6} style={{ cursor }} onClick={go} />;
                  return s.hollow ? (
                    <circle cx={cx} cy={cy} r={DOT_R + 1} className={HOLLOW_CLASS} fill="#161616" stroke={s.color} strokeWidth={1.4} style={{ cursor }} onClick={go} />
                  ) : (
                    <circle cx={cx} cy={cy} r={DOT_R} className={DOT_CLASS} fill={s.color} fillOpacity={0.7} style={{ cursor }} onClick={go} />
                  );
                }}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div role={toggle ? "group" : undefined} aria-label={toggle ? "계열 표시" : undefined} className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {series.map((s) =>
          toggle ? (
            <button
              key={s.id}
              type="button"
              aria-pressed={!hidden.has(s.id)}
              onClick={() => flip(s.id)}
              className={`flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-[family-name:var(--font-geist-mono)] text-[12px] font-medium text-muted ${
                hidden.has(s.id) ? "opacity-35" : ""
              }`}
            >
              <span className={s.emphasis ? "h-2.5 w-2.5 rounded-full" : "h-2 w-2 rounded-full"} style={s.hollow || s.emphasis ? { border: `1.5px solid ${s.color}` } : { background: s.color }} />
              {s.label}
            </button>
          ) : (
            <span key={s.id} className="flex items-center gap-1.5 text-[11px] text-sub">
              <span className={s.emphasis ? "h-2.5 w-2.5 rounded-full" : "h-2 w-2 rounded-full"} style={s.hollow || s.emphasis ? { border: `1.5px solid ${s.color}` } : { background: s.color }} />
              {s.label}
            </span>
          ),
        )}
      </div>
    </div>
  );
}
