"use client";

import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip } from "recharts";
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
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">킬로미터 스플릿</div>
        <div className="h-40 flex items-center justify-center text-[13px] text-dim">로딩 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">킬로미터 스플릿</div>
        <div className="h-20 flex items-center justify-center text-[13px] text-dim">스플릿 데이터를 불러올 수 없습니다</div>
      </div>
    );
  }

  if (laps.length === 0) return null;

  // km 랩만 필터 (워킹/비활성 구간 제외)
  const activeLaps = laps.filter((l) =>
    l.distance >= 900 && l.distance <= 1100
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
  const avgPace = paces.length > 0 ? paces.reduce((s, p) => s + p, 0) / paces.length : 0;
  const maxPace = Math.max(...paces);
  const minPace = Math.min(...paces);

  // 반전: 빠른 페이스(낮은 값)가 높은 막대가 되도록
  // 기준선을 maxPace(가장 느린)로 잡고, 차이를 막대 높이로 사용
  // 최소 높이 보장으로 모든 막대가 보이도록
  const range = maxPace - minPace || 1;
  const barData = chartData.map((d) => ({
    ...d,
    barHeight: ((maxPace - d.pace) / range) * 100 + 15, // 15~115 범위
    originalPace: d.pace,
  }));

  return (
    <div className="space-y-4">
      {/* 페이스 바 차트 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
          킬로미터 스플릿 ({activeLaps.length}km) — 평균 {formatPace(avgPace)}
        </div>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={barData} barCategoryGap="15%">
            <XAxis
              dataKey="km"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "#525252" }}
            />
            <YAxis hide />
            <Tooltip
              contentStyle={{ backgroundColor: "#1e1e1e", border: "1px solid #333333", borderRadius: 8, fontSize: 13, color: "#ededed" }}
              itemStyle={{ color: "#ededed" }}
              labelStyle={{ color: "#a3a3a3", marginBottom: 4 }}
              formatter={(_value, _name, props) => [formatPace(props.payload.originalPace), "페이스"]}
              labelFormatter={(label) => `${label} km`}
            />
            <Bar dataKey="barHeight" radius={[2, 2, 0, 0]}>
              {barData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.originalPace < avgPace ? "#22c55e" : entry.originalPace > avgPace * 1.05 ? "#ef4444" : "#60a5fa"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 스플릿 테이블 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">스플릿 상세</div>
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
