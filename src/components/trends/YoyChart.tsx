"use client";

// #395 (M15-3): 전년 동기. x = 1~12월, 연도별 선. **올해만 지표색 굵은 선, 과거는 회색 사다리 (최근일수록 밝게)** —
// 연도마다 색을 주면 범례를 읽어야 하는 무지개가 된다. 범례 버튼으로 연도를 켜고 끈다 (client state, URL 에 넣지 않음).
// 합계형의 미완결 월 (이번 달 · 하한이 걸친 첫 달) 은 점선 + 속 빈 점 — 부분 합계가 "적게 뛴 달" 로 읽히지 않게.
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { YearPivot } from "@/lib/history/trends";
import {
  CHART_AXIS_TICK,
  CHART_GRID_STROKE,
  CHART_TOOLTIP_CLASS,
  formatAxisValue,
  formatChartValue,
  type ChartMetric,
} from "./chart-format";

interface YoyChartProps {
  pivot: YearPivot;
  metric: ChartMetric;
  color: string;
  currentYear: number;
}

const PAST_GRAYS = ["#3a3a3a", "#4a4a4a", "#5c5c5c", "#737373", "#8f8f8f", "#b0b0b0"];

type Row = { month: number } & Record<string, number | null>;

function yearColor(year: number, years: readonly number[], currentYear: number, color: string): string {
  if (year === currentYear) return color;
  const past = years.filter((y) => y !== currentYear);
  const rank = past.indexOf(year); // 0 = 가장 오래된 해
  const offset = PAST_GRAYS.length - past.length;
  return PAST_GRAYS[Math.max(0, Math.min(PAST_GRAYS.length - 1, rank + offset))];
}

export default function YoyChart({ pivot, metric, color, currentYear }: YoyChartProps) {
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());
  const isSum = metric.aggregate === "sum";

  // 실선 = 완결 · 기록 충분한 달. 점선 = 직전 완결 달 → 미완결 달 (합계형만)
  const rows: Row[] = Array.from({ length: 12 }, (_, i) => {
    const row: Row = { month: i + 1 };
    for (const year of pivot.years) {
      const cell = pivot.cells[year]?.[i] ?? null;
      const usable = cell !== null && cell.value !== null && !cell.lowCoverage;
      const partial = usable && isSum && cell.partial;
      row[`y${year}`] = usable && !partial ? cell.value : null;
      const next = pivot.cells[year]?.[i + 1] ?? null;
      const leadsToPartial = isSum && next !== null && next.partial && next.value !== null && !next.lowCoverage;
      row[`p${year}`] = partial || (usable && leadsToPartial) ? cell.value : null;
    }
    return row;
  });
  const visible = pivot.years.filter((y) => !hidden.has(y));

  function toggle(year: number) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }

  return (
    <div>
      <div className="h-[220px] sm:h-[320px]" role="img" aria-label={`${metric.label} 전년 동기 비교`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
              cursor={{ stroke: "#333333" }}
              content={({ active, payload, label }) => {
                if (!active || !payload) return null;
                const row = payload[0]?.payload as Row | undefined;
                if (!row) return null;
                const items = [...visible].reverse().flatMap((year) => {
                  const value = row[`y${year}`] ?? row[`p${year}`];
                  return value === null || value === undefined ? [] : [{ year, value, partial: row[`y${year}`] === null }];
                });
                if (items.length === 0) return null;
                return (
                  <div className={CHART_TOOLTIP_CLASS}>
                    <div className="text-sub">{label}월</div>
                    {items.map((it) => (
                      <div key={it.year} className="flex justify-between gap-4 font-[family-name:var(--font-geist-mono)]">
                        <span style={{ color: yearColor(it.year, pivot.years, currentYear, color) }}>{it.year}</span>
                        <span className={it.year === currentYear ? "text-bright" : ""}>
                          {formatChartValue(metric, it.value)}
                          {it.partial ? " (진행 중)" : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {visible.flatMap((year) => {
              const stroke = yearColor(year, pivot.years, currentYear, color);
              const current = year === currentYear;
              return [
                <Line
                  key={`y${year}`}
                  dataKey={`y${year}`}
                  stroke={stroke}
                  strokeWidth={current ? 2.6 : 1.4}
                  dot={current ? { r: 3, fill: stroke, strokeWidth: 0 } : false}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />,
                <Line
                  key={`p${year}`}
                  dataKey={`p${year}`}
                  stroke={stroke}
                  strokeWidth={current ? 2 : 1.2}
                  strokeDasharray="4 3"
                  // 점선은 "직전 완결 달 → 미완결 달" 두 점을 잇는다. 속 빈 점은 미완결 달에만 (실선 값이 없는 쪽)
                  dot={({ cx, cy, payload, index }: { cx?: number; cy?: number; payload: Row; index: number }) =>
                    cx === undefined || cy === undefined || payload[`y${year}`] !== null || payload[`p${year}`] === null ? (
                      <g key={index} />
                    ) : (
                      <circle key={index} cx={cx} cy={cy} r={3.5} fill="#161616" stroke={stroke} strokeWidth={1.5} />
                    )
                  }
                  activeDot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />,
              ];
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div role="group" aria-label="연도 표시" className="mt-2.5 flex flex-wrap gap-1.5">
        {pivot.years.map((year) => {
          const off = hidden.has(year);
          return (
            <button
              key={year}
              type="button"
              aria-pressed={!off}
              onClick={() => toggle(year)}
              className={`flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-[family-name:var(--font-geist-mono)] text-[12px] font-medium text-muted hover:border-border-hover ${off ? "opacity-35" : ""}`}
            >
              <span className="h-0.5 w-3.5" style={{ background: yearColor(year, pivot.years, currentYear, color) }} />
              {year}
            </button>
          );
        })}
      </div>
    </div>
  );
}
