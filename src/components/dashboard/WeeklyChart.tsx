"use client";

import {
  BarChart,
  Bar,
  XAxis,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface DataPoint {
  date: string;
  value: number | null;
}

interface WeeklyChartProps {
  title: string;
  data: DataPoint[];
  color?: string;
}

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

function getDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return DAYS[d.getDay()];
}

export default function WeeklyChart({
  title,
  data,
  color = "#22c55e",
}: WeeklyChartProps) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const chartData = data.map((d) => ({
    day: getDayLabel(d.date),
    value: d.value ?? 0,
    isToday: d.date === todayStr,
  }));

  if (chartData.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
          {title}
        </div>
        <div className="h-20 flex items-center justify-center text-[13px] text-dim">
          데이터 없음
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
        {title}
      </div>
      <ResponsiveContainer width="100%" height={80}>
        <BarChart data={chartData} barCategoryGap="20%">
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9, fill: "#525252" }}
          />
          <Bar dataKey="value" radius={[2, 2, 0, 0]}>
            {chartData.map((entry, index) => (
              <Cell
                key={index}
                fill={color}
                fillOpacity={entry.isToday ? 1 : 0.25}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
