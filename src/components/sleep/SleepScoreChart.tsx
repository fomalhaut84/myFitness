"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface DataPoint {
  date: string;
  score: number | null;
}

interface SleepScoreChartProps {
  data: DataPoint[];
}

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function SleepScoreChart({ data }: SleepScoreChartProps) {
  const chartData = data.map((d) => ({
    date: formatDay(d.date),
    score: d.score,
  }));

  if (chartData.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
          수면 점수 추세 (30일)
        </div>
        <div className="h-40 flex items-center justify-center text-[13px] text-dim">
          데이터 없음
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
        수면 점수 추세 (30일)
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={chartData}>
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9, fill: "#525252" }}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 100]}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9, fill: "#525252" }}
            width={30}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#161616",
              border: "1px solid #262626",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "#737373" }}
          />
          <Line
            type="monotone"
            dataKey="score"
            stroke="#a78bfa"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
