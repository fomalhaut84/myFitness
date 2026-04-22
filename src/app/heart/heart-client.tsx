"use client";

import { useState } from "react";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
} from "recharts";
import TrendLineChart from "@/components/ui/TrendLineChart";

interface DataPoint {
  date: string;
  value: number | null;
}

interface HRRecord {
  date: string;
  restingHR: number | null;
  avgHR: number | null;
  maxHR: number | null;
  minHR: number | null;
  hrvStatus: number | null;
}

interface BPPoint {
  date: string;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  category: string | null;
}

interface BPCorrelationPoint {
  date: string;
  systolic: number;
  diastolic: number;
  sleepScore: number | null;
  avgStress: number | null;
  bodyBattery: number | null;
  restingHR: number | null;
}

interface LatestBP {
  date: string;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  category: string | null;
}

interface HeartClientProps {
  todayRestingHR: number | null;
  todayHRV: number | null;
  hrTrend: DataPoint[];
  hrvTrend: DataPoint[];
  respirationTrend: DataPoint[];
  recentRecords: HRRecord[];
  latestBP: LatestBP | null;
  bpTrend: BPPoint[];
  bpCorrelation: BPCorrelationPoint[];
}

const BP_CATEGORY_META: Record<
  string,
  { label: string; badge: string }
> = {
  NORMAL: { label: "정상", badge: "bg-green-900/40 text-green-300" },
  HIGH_NORMAL: { label: "고정상", badge: "bg-yellow-900/40 text-yellow-300" },
  STAGE_1_HIGH: {
    label: "1단계 고혈압",
    badge: "bg-orange-900/40 text-orange-300",
  },
  STAGE_2_HIGH: {
    label: "2단계 고혈압",
    badge: "bg-red-900/40 text-red-300",
  },
};

export default function HeartClient({
  todayRestingHR,
  todayHRV,
  hrTrend,
  hrvTrend,
  respirationTrend,
  recentRecords,
  latestBP,
  bpTrend,
  bpCorrelation,
}: HeartClientProps) {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-1">심박 / 혈압</h1>
        <p className="text-dim text-sm">심박수 · HRV · 혈압 추세 · 상관분석</p>
      </div>

      {/* 오늘 요약 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="안정시 심박" value={todayRestingHR} unit="bpm" />
        <StatCard label="HRV" value={todayHRV} unit="ms" />
        {latestBP && (
          <>
            <StatCard
              label="혈압"
              value={`${latestBP.systolic}/${latestBP.diastolic}`}
              unit="mmHg"
              badge={
                latestBP.category
                  ? BP_CATEGORY_META[latestBP.category]
                  : undefined
              }
            />
            <StatCard label="맥박" value={latestBP.pulse} unit="bpm" />
          </>
        )}
      </div>

      {/* 심박 추세 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <TrendLineChart
          title="안정시 심박 추세 (30일)"
          data={hrTrend}
          color="#ef4444"
          unit="bpm"
        />
        <TrendLineChart
          title="HRV 추세 (30일)"
          data={hrvTrend}
          color="#f59e0b"
          unit="ms"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <TrendLineChart
          title="호흡수 추세 (30일)"
          data={respirationTrend}
          color="#22c55e"
          unit="회/분"
        />
      </div>

      {/* 혈압 추세 */}
      {bpTrend.length > 0 && <BPTrendChart data={bpTrend} />}

      {/* 상관관계 */}
      {bpCorrelation.length >= 7 && (
        <BPCorrelationSection data={bpCorrelation} />
      )}

      {/* 최근 심박 기록 */}
      <div className="bg-card border border-border rounded-xl p-5 mt-6">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
          최근 심박 기록
        </div>
        {recentRecords.length > 0 ? (
          <div className="space-y-3">
            {recentRecords.map((r, i) => (
              <div key={r.date}>
                {i > 0 && <div className="border-t border-border mb-3" />}
                <div className="flex items-center justify-between">
                  <span className="text-[13px]">{r.date}</span>
                  <div className="flex items-center gap-4 text-[13px]">
                    {r.restingHR !== null && (
                      <span>
                        <span className="text-dim text-[11px] mr-1">안정</span>
                        <span className="font-[family-name:var(--font-geist-mono)]">
                          {r.restingHR}
                        </span>
                      </span>
                    )}
                    {r.maxHR !== null && (
                      <span>
                        <span className="text-dim text-[11px] mr-1">최대</span>
                        <span className="font-[family-name:var(--font-geist-mono)]">
                          {r.maxHR}
                        </span>
                      </span>
                    )}
                    {r.hrvStatus !== null && (
                      <span>
                        <span className="text-dim text-[11px] mr-1">HRV</span>
                        <span className="font-[family-name:var(--font-geist-mono)]">
                          {r.hrvStatus}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4 text-dim text-[13px]">
            심박 기록 없음
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  badge,
}: {
  label: string;
  value: number | string | null;
  unit?: string;
  badge?: { label: string; badge: string };
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-[11px] text-dim tracking-wider uppercase mb-2">
        {label}
      </div>
      <div className="text-2xl font-semibold font-[family-name:var(--font-geist-mono)]">
        {value ?? "—"}
        {value !== null && unit && (
          <span className="text-sm text-dim font-normal ml-1">{unit}</span>
        )}
      </div>
      {badge && (
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded mt-1 inline-block ${badge.badge}`}
        >
          {badge.label}
        </span>
      )}
    </div>
  );
}

function BPTrendChart({ data }: { data: BPPoint[] }) {
  const [range, setRange] = useState<30 | 90>(30);
  // 날짜 기준 필터: 최신 데이터 기준으로 정확히 range일 표시.
  // latest - (range-1)일 → 오늘 포함 range일.
  const latest = data.length > 0 ? new Date(data[data.length - 1].date).getTime() : 0;
  const cutoffMs = latest - (range - 1) * 24 * 60 * 60 * 1000;
  const filtered = data.filter(
    (d) => new Date(d.date).getTime() >= cutoffMs
  );

  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[11px] text-dim tracking-wider uppercase">
          혈압 추세
        </div>
        <div className="flex gap-1">
          {([30, 90] as const).map((d) => (
            <button
              key={d}
              onClick={() => setRange(d)}
              className={`text-[10px] px-2 py-1 rounded ${
                range === d
                  ? "bg-accent text-black"
                  : "text-dim hover:text-bright"
              }`}
            >
              {d}일
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-3 text-[10px] text-dim mb-2">
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-[#ef4444]" />
          수축기
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-[#60a5fa]" />
          이완기
        </span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart
          data={filtered}
          margin={{ top: 8, right: 8, bottom: 0, left: -10 }}
        >
          <CartesianGrid stroke="#1e1e1e" vertical={false} />
          {/* 수축기 카테고리 밴드 (120~) */}
          <ReferenceArea y1={120} y2={130} fill="#f59e0b" fillOpacity={0.05} />
          <ReferenceArea y1={130} y2={140} fill="#f97316" fillOpacity={0.05} />
          <ReferenceArea y1={140} y2={200} fill="#ef4444" fillOpacity={0.08} />
          {/* 기준선: 정상 상한 120/80 + 2단계 상한 140/90 */}
          <ReferenceLine y={120} stroke="#333" strokeDasharray="3 3" />
          <ReferenceLine y={80} stroke="#333" strokeDasharray="3 3" />
          <ReferenceLine y={140} stroke="#ef444466" strokeDasharray="3 3" />
          <ReferenceLine y={90} stroke="#ef444466" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#666", fontSize: 10 }}
            tickFormatter={(v: string) => v.slice(5)}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#666", fontSize: 10 }}
            domain={[60, "dataMax + 10"]}
          />
          <Tooltip
            contentStyle={{
              background: "#0a0a0a",
              border: "1px solid #1e1e1e",
              fontSize: 12,
              borderRadius: 6,
            }}
          />
          <Area
            type="monotone"
            dataKey="systolic"
            stroke="none"
            fill="#ef4444"
            fillOpacity={0.1}
            name="수축기"
          />
          <Line
            type="monotone"
            dataKey="systolic"
            stroke="#ef4444"
            strokeWidth={2}
            dot={{ r: 2 }}
            name="수축기"
          />
          <Line
            type="monotone"
            dataKey="diastolic"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={{ r: 2 }}
            name="이완기"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

const CORR_CHARTS = [
  {
    key: "sleepScore" as const,
    label: "혈압 vs 수면 점수",
    color: "#a78bfa",
    unit: "점",
  },
  {
    key: "avgStress" as const,
    label: "혈압 vs 스트레스",
    color: "#f59e0b",
    unit: "",
  },
  {
    key: "bodyBattery" as const,
    label: "혈압 vs 바디배터리",
    color: "#22c55e",
    unit: "",
  },
  {
    key: "restingHR" as const,
    label: "혈압 vs 안정시 심박",
    color: "#ef4444",
    unit: "bpm",
  },
];

function BPCorrelationSection({
  data,
}: {
  data: BPCorrelationPoint[];
}) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold mb-1">혈압 상관분석</h2>
      <p className="text-dim text-[12px] mb-4">
        수축기 혈압과 건강 지표의 관계 (90일)
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {CORR_CHARTS.map((chart) => {
          const hasData = data.some((d) => d[chart.key] !== null);
          if (!hasData) return null;
          return (
            <div
              key={chart.key}
              className="bg-card border border-border rounded-xl p-5"
            >
              <div className="text-[11px] text-dim tracking-wider uppercase mb-3">
                {chart.label}
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <ComposedChart
                  data={data}
                  margin={{ top: 8, right: 40, bottom: 0, left: -10 }}
                >
                  <CartesianGrid stroke="#1e1e1e" vertical={false} />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#666", fontSize: 9 }}
                    tickFormatter={(v: string) => v.slice(5)}
                  />
                  <YAxis
                    yAxisId="bp"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#666", fontSize: 9 }}
                    domain={["dataMin - 5", "dataMax + 5"]}
                  />
                  <YAxis
                    yAxisId="metric"
                    orientation="right"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#666", fontSize: 9 }}
                    domain={["dataMin - 5", "dataMax + 5"]}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#0a0a0a",
                      border: "1px solid #1e1e1e",
                      fontSize: 11,
                      borderRadius: 6,
                    }}
                  />
                  <Line
                    type="monotone"
                    yAxisId="bp"
                    dataKey="systolic"
                    stroke="#ef4444"
                    strokeWidth={1.5}
                    dot={false}
                    name="수축기"
                  />
                  <Line
                    type="monotone"
                    yAxisId="metric"
                    dataKey={chart.key}
                    stroke={chart.color}
                    strokeWidth={1.5}
                    dot={false}
                    name={chart.label.split(" vs ")[1]}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          );
        })}
      </div>
    </div>
  );
}
