"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import TrendLineChart from "@/components/ui/TrendLineChart";

interface DataPoint {
  date: string;
  value: number | null;
}

interface BodyRecord {
  date: string;
  weight: number;
  bmi: number | null;
  bodyFat: number | null;
  muscleMass: number | null;
}

interface CaloriePoint {
  date: string;
  intake: number | null;
  available: number | null;
  balance: number | null;
  active: number | null;
}

interface WeeklySummaryRow {
  weekStartLabel: string;
  weekEndLabel: string;
  avgDailyBalance: number | null;
  projectedLossKg: number | null;
  weightChangeKg: number | null;
  daysWithData: number;
}

interface WeeklyDistance {
  weekLabel: string;
  distanceKm: number;
}

interface GoalProgress {
  currentWeight: number | null;
  targetWeight: number | null;
  targetDate: string | null;
  remainingKg: number | null;
  lostKg: number | null;
  percentComplete: number | null;
}

interface BodyClientProps {
  latestWeight: number | null;
  latestBMI: number | null;
  latestBodyFat: number | null;
  weightTrend: DataPoint[];
  weightMA7: DataPoint[];
  weightMA14: DataPoint[];
  fatTrend: DataPoint[];
  recentRecords: BodyRecord[];
  calorieSeries: CaloriePoint[];
  weeklySummaries: WeeklySummaryRow[];
  weeklyDistances: WeeklyDistance[];
  goalProgress: GoalProgress;
  todayDate: string;
}

export default function BodyClient({
  latestWeight,
  latestBMI,
  latestBodyFat,
  weightTrend,
  weightMA7,
  weightMA14,
  fatTrend,
  recentRecords,
  calorieSeries,
  weeklySummaries,
  weeklyDistances,
  goalProgress,
}: BodyClientProps) {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-1">체성분 / 감량</h1>
        <p className="text-dim text-sm">
          체중 · 체지방 · 칼로리 밸런스 · 감량 진행도
        </p>
      </div>

      {/* 목표 진행도 */}
      {goalProgress.targetWeight !== null && (
        <GoalProgressCard progress={goalProgress} />
      )}

      {/* 최근 수치 */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="체중" value={latestWeight?.toFixed(1) ?? "—"} unit="kg" />
        <Stat label="BMI" value={latestBMI?.toFixed(1) ?? "—"} />
        <Stat
          label="체지방률"
          value={latestBodyFat?.toFixed(1) ?? "—"}
          unit="%"
        />
      </div>

      {/* 체중 추세 (이동평균 포함) */}
      <WeightTrendChart raw={weightTrend} ma7={weightMA7} ma14={weightMA14} />

      {/* 체지방률 + 칼로리 밸런스 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        {fatTrend.length > 0 && (
          <TrendLineChart
            title="체지방률 추세 (30일)"
            data={fatTrend}
            color="#a78bfa"
            unit="%"
          />
        )}
        <WeeklyDistanceChart data={weeklyDistances} />
      </div>

      {/* 칼로리 밸런스 일별 */}
      {calorieSeries.length > 0 && <CalorieBalanceChart data={calorieSeries} />}

      {/* 주간 요약 테이블 */}
      {weeklySummaries.length > 0 && (
        <WeeklySummaryTable rows={weeklySummaries} />
      )}

      {/* 최근 기록 */}
      <div className="bg-card border border-border rounded-xl p-5 mt-6">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
          최근 체중 기록
        </div>
        {recentRecords.length > 0 ? (
          <div className="space-y-3">
            {recentRecords.map((r, i) => (
              <div key={r.date}>
                {i > 0 && <div className="border-t border-border mb-3" />}
                <div className="flex items-center justify-between">
                  <span className="text-[13px]">{r.date}</span>
                  <div className="flex items-center gap-4 text-[13px]">
                    <span className="font-[family-name:var(--font-geist-mono)]">
                      {r.weight.toFixed(1)}
                      <span className="text-dim ml-1">kg</span>
                    </span>
                    {r.bodyFat !== null && (
                      <span className="font-[family-name:var(--font-geist-mono)]">
                        {r.bodyFat.toFixed(1)}
                        <span className="text-dim ml-1">%</span>
                      </span>
                    )}
                    {r.muscleMass !== null && (
                      <span className="font-[family-name:var(--font-geist-mono)]">
                        {r.muscleMass.toFixed(1)}
                        <span className="text-dim ml-1">kg 근육</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4 text-dim text-[13px]">
            체중 기록 없음
          </div>
        )}
      </div>

      {/* 식단 기록 */}
      <div className="mt-10">
        <h2 className="text-lg font-semibold mb-1">식단 기록</h2>
        <p className="text-dim text-[12px] mb-4">
          간단히 기록하면 칼로리를 추정합니다
        </p>
        <FoodInput />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-[11px] text-dim tracking-wider uppercase mb-2">
        {label}
      </div>
      <div className="text-2xl font-semibold font-[family-name:var(--font-geist-mono)]">
        {value}
        {unit && value !== "—" && (
          <span className="text-sm text-dim font-normal ml-1">{unit}</span>
        )}
      </div>
    </div>
  );
}

function GoalProgressCard({ progress }: { progress: GoalProgress }) {
  const { currentWeight, targetWeight, targetDate, remainingKg, lostKg, percentComplete } =
    progress;
  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] text-dim tracking-wider uppercase">
          목표 진행도
        </div>
        {targetDate && (
          <div className="text-[11px] text-dim">목표일: {targetDate}</div>
        )}
      </div>

      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="text-[11px] text-dim">현재</div>
          <div className="text-xl font-semibold font-[family-name:var(--font-geist-mono)]">
            {currentWeight?.toFixed(1) ?? "—"}
            <span className="text-sm text-dim font-normal ml-1">kg</span>
          </div>
        </div>
        <div className="text-dim">→</div>
        <div>
          <div className="text-[11px] text-dim">목표</div>
          <div className="text-xl font-semibold font-[family-name:var(--font-geist-mono)]">
            {targetWeight?.toFixed(1) ?? "—"}
            <span className="text-sm text-dim font-normal ml-1">kg</span>
          </div>
        </div>
        <div>
          <div className="text-[11px] text-dim">남은</div>
          <div className="text-xl font-semibold font-[family-name:var(--font-geist-mono)] text-accent">
            {remainingKg !== null
              ? `${remainingKg > 0 ? "" : "+"}${Math.abs(remainingKg).toFixed(1)}`
              : "—"}
            <span className="text-sm text-dim font-normal ml-1">kg</span>
          </div>
        </div>
      </div>

      {percentComplete !== null && (
        <>
          <div className="h-2 rounded bg-surface overflow-hidden mb-2">
            <div
              className="h-full bg-accent rounded"
              style={{ width: `${percentComplete}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-dim">
            <span>
              {lostKg !== null && `${lostKg.toFixed(1)}kg 감량`}
            </span>
            <span>{percentComplete.toFixed(0)}% 진행</span>
          </div>
        </>
      )}
    </div>
  );
}

function WeightTrendChart({
  raw,
  ma7,
  ma14,
}: {
  raw: DataPoint[];
  ma7: DataPoint[];
  ma14: DataPoint[];
}) {
  if (raw.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 mb-6 text-center text-dim text-[13px]">
        체중 데이터 없음
      </div>
    );
  }
  // 모든 날짜를 합쳐서 렌더 (MA는 해당 날짜에만 점 표시)
  const map = new Map<string, { date: string; raw?: number; ma7?: number; ma14?: number }>();
  for (const p of raw) {
    if (p.value === null) continue;
    map.set(p.date, { date: p.date, raw: p.value });
  }
  for (const p of ma7) {
    if (p.value === null) continue;
    const existing = map.get(p.date) ?? { date: p.date };
    existing.ma7 = p.value;
    map.set(p.date, existing);
  }
  for (const p of ma14) {
    if (p.value === null) continue;
    const existing = map.get(p.date) ?? { date: p.date };
    existing.ma14 = p.value;
    map.set(p.date, existing);
  }
  const data = Array.from(map.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[11px] text-dim tracking-wider uppercase">
          체중 추세 (30일)
        </div>
        <div className="flex gap-3 text-[10px] text-dim">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#60a5fa80]" />
            일별
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-[#22c55e]" />
            7일 평균
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-[#a78bfa]" />
            14일 평균
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
          <CartesianGrid stroke="#1e1e1e" vertical={false} />
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
            domain={["dataMin - 0.5", "dataMax + 0.5"]}
            tickFormatter={(v: number) => v.toFixed(1)}
          />
          <Tooltip
            contentStyle={{
              background: "#0a0a0a",
              border: "1px solid #1e1e1e",
              fontSize: 12,
              borderRadius: 6,
            }}
            formatter={(v) => {
              const n = typeof v === "number" ? v : Number(v);
              return Number.isFinite(n) ? `${n.toFixed(2)} kg` : "—";
            }}
          />
          <Bar dataKey="raw" fill="#60a5fa80" name="일별" />
          <Line
            type="monotone"
            dataKey="ma7"
            stroke="#22c55e"
            strokeWidth={2}
            dot={false}
            name="7일 평균"
          />
          <Line
            type="monotone"
            dataKey="ma14"
            stroke="#a78bfa"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            name="14일 평균"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function CalorieBalanceChart({ data }: { data: CaloriePoint[] }) {
  const chartData = data.map((d) => ({
    date: d.date,
    intake: d.intake,
    available: d.available,
    balance: d.balance,
    deficit: d.balance !== null && d.balance < 0 ? d.balance : null,
    surplus: d.balance !== null && d.balance > 0 ? d.balance : null,
  }));

  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[11px] text-dim tracking-wider uppercase">
          칼로리 밸런스 (30일)
        </div>
        <div className="flex gap-3 text-[10px] text-dim">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-[#22c55e]" />
            결손
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-[#ef4444]" />
            잉여
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
          <CartesianGrid stroke="#1e1e1e" vertical={false} />
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
            tickFormatter={(v: number) =>
              v === 0 ? "0" : v > 0 ? `+${v}` : String(v)
            }
          />
          <ReferenceLine y={0} stroke="#333" />
          <Tooltip
            contentStyle={{
              background: "#0a0a0a",
              border: "1px solid #1e1e1e",
              fontSize: 12,
              borderRadius: 6,
            }}
            formatter={(v) => {
              const n = typeof v === "number" ? v : Number(v);
              if (!Number.isFinite(n)) return "—";
              return `${n > 0 ? "+" : ""}${n} kcal`;
            }}
          />
          <Bar dataKey="deficit" fill="#22c55e" name="결손" />
          <Bar dataKey="surplus" fill="#ef4444" name="잉여" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function WeeklyDistanceChart({ data }: { data: WeeklyDistance[] }) {
  if (data.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 text-center text-dim text-[13px]">
        러닝 데이터 없음
      </div>
    );
  }
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
        주간 러닝 거리 (8주)
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
          <CartesianGrid stroke="#1e1e1e" vertical={false} />
          <XAxis
            dataKey="weekLabel"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#666", fontSize: 10 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#666", fontSize: 10 }}
            tickFormatter={(v: number) => `${v}`}
          />
          <Tooltip
            contentStyle={{
              background: "#0a0a0a",
              border: "1px solid #1e1e1e",
              fontSize: 12,
              borderRadius: 6,
            }}
            formatter={(v) => {
              const n = typeof v === "number" ? v : Number(v);
              return Number.isFinite(n) ? `${n} km` : "—";
            }}
          />
          <Bar dataKey="distanceKm" fill="#22c55e" name="거리" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function WeeklySummaryTable({ rows }: { rows: WeeklySummaryRow[] }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-6">
      <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
        주간 요약 (최근 4주)
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-dim border-b border-border">
              <th className="text-left py-2 font-normal">주</th>
              <th className="text-right py-2 font-normal">평균 결손</th>
              <th className="text-right py-2 font-normal">예상 감량</th>
              <th className="text-right py-2 font-normal">실제 감량</th>
              <th className="text-right py-2 font-normal">데이터</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const deficitClass =
                r.avgDailyBalance === null
                  ? "text-dim"
                  : r.avgDailyBalance <= -1000
                    ? "text-yellow-400"
                    : r.avgDailyBalance < 0
                      ? "text-accent"
                      : "text-red-400";
              return (
                <tr key={r.weekStartLabel} className="border-b border-border/50">
                  <td className="py-2">
                    {r.weekStartLabel.slice(5)} ~ {r.weekEndLabel.slice(5)}
                  </td>
                  <td
                    className={`text-right font-[family-name:var(--font-geist-mono)] ${deficitClass}`}
                  >
                    {r.avgDailyBalance !== null
                      ? `${r.avgDailyBalance > 0 ? "+" : ""}${r.avgDailyBalance}`
                      : "—"}
                  </td>
                  <td className="text-right font-[family-name:var(--font-geist-mono)] text-sub">
                    {r.projectedLossKg !== null
                      ? `${r.projectedLossKg.toFixed(2)} kg`
                      : "—"}
                  </td>
                  <td className="text-right font-[family-name:var(--font-geist-mono)] text-sub">
                    {r.weightChangeKg !== null
                      ? // weightChangeKg > 0 = 감량 → "1.50 kg", < 0 = 증가 → "-1.50 kg"
                        `${r.weightChangeKg >= 0 ? "" : "-"}${Math.abs(r.weightChangeKg).toFixed(2)} kg`
                      : "—"}
                  </td>
                  <td className="text-right text-dim">
                    {r.daysWithData}/7일
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FoodInput() {
  const [desc, setDesc] = useState("");
  const [meal, setMeal] = useState("lunch");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<
    { description: string; estimatedKcal: number; mealType: string }[]
  >([]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!desc.trim() || loading) return;
    setLoading(true);

    try {
      const res = await fetch("/api/food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc, mealType: meal }),
      });
      const data = await res.json();
      if (data.data) {
        setLogs((prev) => [data.data, ...prev]);
        setDesc("");
      }
    } finally {
      setLoading(false);
    }
  }

  const mealLabels: Record<string, string> = {
    breakfast: "아침",
    lunch: "점심",
    dinner: "저녁",
    snack: "간식",
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <form onSubmit={submit} className="flex gap-2 mb-4">
        <select
          value={meal}
          onChange={(e) => setMeal(e.target.value)}
          className="bg-surface border border-border rounded-lg px-3 py-2 text-[13px] text-bright"
        >
          <option value="breakfast">아침</option>
          <option value="lunch">점심</option>
          <option value="dinner">저녁</option>
          <option value="snack">간식</option>
        </select>
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="먹은 것을 입력하세요 (예: 김치찌개, 밥, 계란후라이)"
          className="flex-1 bg-surface border border-border rounded-lg px-4 py-2 text-[13px] text-bright placeholder:text-dim focus:outline-none focus:border-accent/50"
        />
        <button
          type="submit"
          disabled={loading || !desc.trim()}
          className="px-4 py-2 rounded-lg bg-accent text-[#0a0a0a] text-[12px] font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
        >
          기록
        </button>
      </form>

      {logs.length > 0 && (
        <div className="space-y-2">
          {logs.map((l, i) => (
            <div key={i} className="flex items-center justify-between text-[13px]">
              <div>
                <span className="text-dim mr-2">
                  {mealLabels[l.mealType] ?? l.mealType}
                </span>
                <span>{l.description}</span>
              </div>
              <span className="font-[family-name:var(--font-geist-mono)]">
                ~{l.estimatedKcal} <span className="text-dim">kcal</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
