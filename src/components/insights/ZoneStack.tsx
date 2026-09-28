"use client";

// #397 C: 월별 심박 존 비율 (100% 스택). 존 색은 활동 상세의 5색 그대로 (범주 색 — "한 화면 한 지표 색" 의 예외).
// 존 없는 달 = 빈 칸, 존 있는 러닝이 절반 미만 = 흐림 (#395 저커버리지), 이번 달 = 점선 (#395 미완결).
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_TOOLTIP_CLASS } from "@/components/trends/chart-format";
import { formatDuration } from "@/lib/format";
import type { ZoneMonth } from "@/lib/insights/zones";

import { ZONE_COLORS, ZONE_NAMES } from "./zone-colors";
const OPACITY = { normal: 0.85, low: 0.28, current: 0.45 } as const;

type Row = { key: string; z1: number; z2: number; z3: number; z4: number; z5: number; empty: number; month: ZoneMonth };

export default function ZoneStack({ months }: { months: readonly ZoneMonth[] }) {
  const rows: Row[] = months.map((m) => ({
    key: m.key,
    z1: m.share?.[0] ?? 0,
    z2: m.share?.[1] ?? 0,
    z3: m.share?.[2] ?? 0,
    z4: m.share?.[3] ?? 0,
    z5: m.share?.[4] ?? 0,
    // 러닝은 있는데 존이 없는 달 = 점선 빈 칸 ("기록 없음 = 뚫린 칸"). 러닝도 없는 달은 그냥 공백
    empty: m.share === null && m.runs > 0 ? 1 : 0,
    month: m,
  }));
  const byKey = new Map(rows.map((r) => [r.key, r]));

  return (
    <div className="h-[220px] sm:h-[280px]" role="img" aria-label="월별 심박 존 시간 비율">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} stackOffset="expand" margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke={CHART_GRID_STROKE} />
          <XAxis
            dataKey="key"
            interval={0}
            axisLine={false}
            tickLine={false}
            tick={({ x, y, payload }) => {
              const key = String(payload.value);
              const isYear = key.endsWith("-01") || key === rows[0]?.key;
              const idx = rows.findIndex((r) => r.key === key);
              if (!isYear && idx % 3 !== 0) return <g />;
              return (
                <text x={x} y={Number(y) + 12} textAnchor="middle" fontSize={10} fill={isYear ? "#a3a3a3" : "#525252"}>
                  {isYear ? key.slice(0, 4) : `${Number(key.slice(5, 7))}월`}
                </text>
              );
            }}
          />
          <YAxis width={40} axisLine={false} tickLine={false} tick={CHART_AXIS_TICK} tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`} />
          <Tooltip
            cursor={{ fill: "#ffffff", fillOpacity: 0.04, pointerEvents: "none" }}
            content={({ active, label }) => {
              const r = active ? byKey.get(String(label)) : undefined;
              if (!r) return null;
              const m = r.month;
              return (
                <div className={CHART_TOOLTIP_CLASS}>
                  <div className="font-[family-name:var(--font-geist-mono)] text-sub">{m.key}</div>
                  {m.share && m.seconds ? (
                    ZONE_NAMES.map((name, z) => (
                      <div key={name} className="flex justify-between gap-4">
                        <span style={{ color: ZONE_COLORS[z] }}>
                          존 {z + 1} {name}
                        </span>
                        <span className="font-[family-name:var(--font-geist-mono)] text-bright">
                          {Math.round((m.share as number[])[z] * 100)}% · {formatDuration((m.seconds as number[])[z])}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div>존 분포 없음</div>
                  )}
                  <div>
                    존 있는 러닝 {m.withZones}/{m.runs}
                    {m.lowCoverage ? " (절반 미만)" : ""}
                  </div>
                  {m.current && <div>아직 끝나지 않은 달</div>}
                </div>
              );
            }}
          />
          <Bar dataKey="empty" stackId="zones" isAnimationActive={false} fill="none" stroke="#2a2a2a" strokeDasharray="2 3" />
          {(["z1", "z2", "z3", "z4", "z5"] as const).map((k, z) => (
            <Bar key={k} dataKey={k} stackId="zones" isAnimationActive={false}>
              {rows.map((r) => (
                <Cell
                  key={r.key}
                  fill={ZONE_COLORS[z]}
                  fillOpacity={r.month.lowCoverage ? OPACITY.low : r.month.current ? OPACITY.current : OPACITY.normal}
                  stroke={r.month.current && !r.month.lowCoverage ? ZONE_COLORS[z] : undefined}
                  strokeDasharray={r.month.current && !r.month.lowCoverage ? "3 2" : undefined}
                />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
