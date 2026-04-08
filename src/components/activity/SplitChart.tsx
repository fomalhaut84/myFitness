"use client";

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip } from "recharts";
import { formatPace } from "@/lib/format";

interface Split {
  distance: number;
  duration: number;
  elevationGain: number;
  averageSpeed: number;
  averageHR: number;
  maxHR: number;
  averageRunCadence: number;
}

interface SplitChartProps {
  splits: Split[];
}

export default function SplitChart({ splits }: SplitChartProps) {
  const chartData = splits.map((s, i) => {
    const paceSecKm = s.averageSpeed > 0 ? 1000 / s.averageSpeed : 0;
    return {
      km: `${i + 1}`,
      pace: Math.round(paceSecKm),
      hr: Math.round(s.averageHR),
      cadence: Math.round(s.averageRunCadence || 0),
      elevation: Math.round(s.elevationGain || 0),
    };
  });

  const paces = chartData.map((d) => d.pace).filter((p) => p > 0);
  const avgPace = paces.length > 0 ? paces.reduce((s, p) => s + p, 0) / paces.length : 0;

  return (
    <div className="space-y-4">
      {/* 페이스 바 차트 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
          스플릿 페이스
        </div>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={chartData} barCategoryGap="15%">
            <XAxis
              dataKey="km"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "#525252" }}
            />
            <YAxis
              reversed
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 9, fill: "#525252" }}
              width={40}
              tickFormatter={(v) => formatPace(v)}
            />
            <Tooltip
              contentStyle={{ backgroundColor: "#161616", border: "1px solid #262626", borderRadius: 8, fontSize: 12 }}
              formatter={(value) => [formatPace(Number(value)), "페이스"]}
              labelFormatter={(label) => `${label} km`}
            />
            <Bar dataKey="pace" radius={[2, 2, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.pace < avgPace ? "#22c55e" : entry.pace > avgPace * 1.05 ? "#ef4444" : "#60a5fa"}
                />
              ))}
            </Bar>
          </BarChart>
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
                    <span style={{ color: d.pace < avgPace ? "#22c55e" : d.pace > avgPace * 1.05 ? "#ef4444" : "#a3a3a3" }}>
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
