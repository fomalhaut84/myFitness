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
  value: number | null;
}

interface TrendLineChartProps {
  title: string;
  data: DataPoint[];
  color: string;
  unit?: string;
  height?: number;
  domain?: [number | "auto", number | "auto"];
}

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function TrendLineChart({
  title,
  data,
  color,
  unit,
  height = 160,
  domain,
}: TrendLineChartProps) {
  const chartData = data.map((d) => ({
    date: formatDay(d.date),
    value: d.value,
  }));

  if (chartData.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
          {title}
        </div>
        <div
          className="flex items-center justify-center text-[13px] text-dim"
          style={{ height }}
        >
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
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData}>
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9, fill: "#525252" }}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={domain ?? ["auto", "auto"]}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9, fill: "#525252" }}
            width={35}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1e1e1e",
              border: "1px solid #333333",
              borderRadius: 8,
              fontSize: 13,
              color: "#ededed",
            }}
            itemStyle={{ color: "#ededed" }}
            labelStyle={{ color: "#737373" }}
            formatter={(value) =>
              unit ? [`${value} ${unit}`, ""] : [`${value}`, ""]
            }
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
