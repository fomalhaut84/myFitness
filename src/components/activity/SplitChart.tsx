"use client";

import { useState, useEffect } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { formatPace } from "@/lib/format";

interface LapDTO {
  distance: number;
  duration: number;
  averageSpeed: number;
  averageHR: number;
  maxHR: number;
  averageRunCadence: number;
  elevationGain: number;
  averagePower?: number;
}

interface SplitChartProps {
  activityId: string;
}

export default function SplitChart({ activityId }: SplitChartProps) {
  const [laps, setLaps] = useState<LapDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/activities/${activityId}/splits`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setLaps(data.data ?? []);
        }
      })
      .catch(() => setError("스플릿 데이터를 불러올 수 없습니다"))
      .finally(() => setLoading(false));
  }, [activityId]);

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
          킬로미터 스플릿
        </div>
        <div className="h-40 flex items-center justify-center text-[13px] text-dim">
          로딩 중...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
          킬로미터 스플릿
        </div>
        <div className="h-20 flex items-center justify-center text-[13px] text-dim">
          스플릿 데이터를 불러올 수 없습니다
        </div>
      </div>
    );
  }

  if (laps.length === 0) return null;

  // km 랩만 필터 (워킹/비활성 구간 제외)
  const activeLaps = laps.filter(
    (l) => l.distance >= 900 && l.distance <= 1100
  );
  if (activeLaps.length === 0) return null;

  const chartData = activeLaps.map((lap, i) => {
    const paceSecKm = lap.averageSpeed > 0 ? 1000 / lap.averageSpeed : 0;
    return {
      km: `${i + 1}`,
      pace: Math.round(paceSecKm),
      hr: Math.round(lap.averageHR || 0),
      cadence: Math.round(lap.averageRunCadence || 0),
      elevation: Math.round(lap.elevationGain || 0),
      power: Math.round(lap.averagePower || 0),
    };
  });

  const paces = chartData.map((d) => d.pace).filter((p) => p > 0);
  const avgPace =
    paces.length > 0 ? paces.reduce((s, p) => s + p, 0) / paces.length : 0;
  const maxPace = Math.max(...paces);
  const minPace = Math.min(...paces);

  const range = maxPace - minPace || 1;
  const barData = chartData.map((d) => ({
    ...d,
    barHeight: ((maxPace - d.pace) / range) * 100 + 15,
    originalPace: d.pace,
  }));

  const hasHR = chartData.some((d) => d.hr > 0);

  return (
    <div className="space-y-4">
      {/* 페이스 바 + HR 라인 오버레이 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[11px] text-dim tracking-wider uppercase">
            킬로미터 스플릿 ({activeLaps.length}km) — 평균{" "}
            {formatPace(avgPace)}
          </div>
          {hasHR && (
            <div className="flex gap-3 text-[10px] text-dim">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-[#60a5fa]" />
                페이스
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-[#ef4444]" />
                심박
              </span>
            </div>
          )}
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart
            data={barData}
            barCategoryGap="15%"
            margin={{ top: 8, right: hasHR ? 40 : 8, bottom: 0, left: -10 }}
          >
            <CartesianGrid stroke="#1e1e1e" vertical={false} />
            <XAxis
              dataKey="km"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "#525252" }}
            />
            <YAxis yAxisId="pace" hide />
            {hasHR && (
              <YAxis
                yAxisId="hr"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#666" }}
                domain={["dataMin - 10", "dataMax + 10"]}
                tickFormatter={(v: number) => `${v}`}
              />
            )}
            <Tooltip
              contentStyle={{
                backgroundColor: "#1e1e1e",
                border: "1px solid #333333",
                borderRadius: 8,
                fontSize: 13,
                color: "#ededed",
              }}
              formatter={(value, name, props) => {
                const v = typeof value === "number" ? value : Number(value);
                if (name === "barHeight") {
                  return [
                    formatPace(props.payload?.originalPace ?? v),
                    "페이스",
                  ];
                }
                if (name === "hr")
                  return [Number.isFinite(v) ? `${v} bpm` : "—", "심박"];
                return [String(value), String(name)];
              }}
              labelFormatter={(label) => `${label} km`}
            />
            <Bar dataKey="barHeight" yAxisId="pace" radius={[2, 2, 0, 0]}>
              {barData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={
                    entry.originalPace < avgPace
                      ? "#22c55e"
                      : entry.originalPace > avgPace * 1.05
                        ? "#ef4444"
                        : "#60a5fa"
                  }
                />
              ))}
            </Bar>
            {hasHR && (
              <Line
                type="monotone"
                dataKey="hr"
                yAxisId="hr"
                stroke="#ef4444"
                strokeWidth={2}
                dot={{ r: 2, fill: "#ef4444" }}
                name="hr"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* 스플릿 테이블 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
          스플릿 상세
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-dim border-b border-border">
                <th className="text-left py-2 font-normal">km</th>
                <th className="text-right py-2 font-normal">페이스</th>
                <th className="text-right py-2 font-normal">HR</th>
                <th className="text-right py-2 font-normal">케이던스</th>
                <th className="text-right py-2 font-normal">고도↑</th>
              </tr>
            </thead>
            <tbody>
              {chartData.map((d) => (
                <tr key={d.km} className="border-b border-border/50">
                  <td className="py-2">{d.km}</td>
                  <td className="text-right font-[family-name:var(--font-geist-mono)]">
                    <span
                      style={{
                        color:
                          d.pace < avgPace
                            ? "#22c55e"
                            : d.pace > avgPace * 1.05
                              ? "#ef4444"
                              : "#a3a3a3",
                      }}
                    >
                      {formatPace(d.pace)}
                    </span>
                  </td>
                  <td className="text-right font-[family-name:var(--font-geist-mono)]">
                    {d.hr > 0 ? d.hr : "—"}
                  </td>
                  <td className="text-right font-[family-name:var(--font-geist-mono)]">
                    {d.cadence > 0 ? d.cadence : "—"}
                  </td>
                  <td className="text-right font-[family-name:var(--font-geist-mono)]">
                    {d.elevation > 0 ? `+${d.elevation}m` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
