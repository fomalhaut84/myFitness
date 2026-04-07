"use client";

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip } from "recharts";

interface WeekVolume {
  weekLabel: string;
  distanceKm: number;
  count: number;
}

interface OvertrainingRisk {
  hrRising: boolean;
  hrvDropping: boolean;
  sleepDeclining: boolean;
  riskLevel: "low" | "moderate" | "high";
}

interface TrainingLoadProps {
  weeklyVolumes: WeekVolume[];
  overtrainingRisk: OvertrainingRisk;
}

export default function TrainingLoad({
  weeklyVolumes,
  overtrainingRisk,
}: TrainingLoadProps) {
  // 주간 증가율 계산
  const latestWeek = weeklyVolumes[weeklyVolumes.length - 1];
  const prevWeek = weeklyVolumes.length > 1 ? weeklyVolumes[weeklyVolumes.length - 2] : null;
  const increaseRate = prevWeek && prevWeek.distanceKm > 0
    ? Math.round(((latestWeek?.distanceKm ?? 0) - prevWeek.distanceKm) / prevWeek.distanceKm * 100)
    : null;

  const riskColors = { low: "#22c55e", moderate: "#f59e0b", high: "#ef4444" };
  const riskLabels = { low: "낮음", moderate: "보통", high: "높음" };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">트레이닝 로드</h2>
        <p className="text-dim text-[12px] mb-4">주간 볼륨 + 오버트레이닝 위험</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 주간 볼륨 차트 */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[11px] text-dim tracking-wider uppercase">주간 러닝 볼륨 (8주)</span>
            {increaseRate !== null && (
              <span className={`text-[11px] ${Math.abs(increaseRate) > 10 ? "text-[#ef4444]" : "text-[#22c55e]"}`}>
                {increaseRate > 0 ? "+" : ""}{increaseRate}% 전주 대비
              </span>
            )}
          </div>
          {weeklyVolumes.length > 0 ? (
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={weeklyVolumes} barCategoryGap="15%">
                <XAxis
                  dataKey="weekLabel"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 9, fill: "#525252" }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 9, fill: "#525252" }}
                  width={30}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "#161616", border: "1px solid #262626", borderRadius: 8, fontSize: 12 }}
                  formatter={(value) => [`${Number(value).toFixed(1)} km`, ""]}
                />
                <Bar dataKey="distanceKm" radius={[2, 2, 0, 0]}>
                  {weeklyVolumes.map((_, i) => (
                    <Cell
                      key={i}
                      fill="#22c55e"
                      fillOpacity={i === weeklyVolumes.length - 1 ? 1 : 0.3}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[120px] flex items-center justify-center text-[13px] text-dim">
              데이터 없음
            </div>
          )}
        </div>

        {/* 오버트레이닝 위험 */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="text-[11px] text-dim tracking-wider uppercase mb-4">오버트레이닝 위험</div>
          <div className="flex items-baseline gap-2 mb-4">
            <span
              className="text-2xl font-semibold"
              style={{ color: riskColors[overtrainingRisk.riskLevel] }}
            >
              {riskLabels[overtrainingRisk.riskLevel]}
            </span>
          </div>
          <div className="space-y-2 text-[12px]">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${overtrainingRisk.hrRising ? "bg-[#ef4444]" : "bg-[#22c55e]"}`} />
              <span className="text-dim">안정시 심박 상승</span>
              <span className="ml-auto">{overtrainingRisk.hrRising ? "감지됨" : "정상"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${overtrainingRisk.hrvDropping ? "bg-[#ef4444]" : "bg-[#22c55e]"}`} />
              <span className="text-dim">HRV 하락</span>
              <span className="ml-auto">{overtrainingRisk.hrvDropping ? "감지됨" : "정상"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${overtrainingRisk.sleepDeclining ? "bg-[#ef4444]" : "bg-[#22c55e]"}`} />
              <span className="text-dim">수면 질 저하</span>
              <span className="ml-auto">{overtrainingRisk.sleepDeclining ? "감지됨" : "정상"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
