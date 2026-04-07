"use client";

import { useState } from "react";
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

interface BodyClientProps {
  latestWeight: number | null;
  latestBMI: number | null;
  latestBodyFat: number | null;
  weightTrend: DataPoint[];
  fatTrend: DataPoint[];
  recentRecords: BodyRecord[];
}

export default function BodyClient({
  latestWeight,
  latestBMI,
  latestBodyFat,
  weightTrend,
  fatTrend,
  recentRecords,
}: BodyClientProps) {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-1">체성분</h1>
        <p className="text-dim text-sm">체중 / 체지방 추세</p>
      </div>

      {/* 최근 수치 */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-[11px] text-dim tracking-wider uppercase mb-2">
            체중
          </div>
          <div className="text-2xl font-semibold font-[family-name:var(--font-geist-mono)]">
            {latestWeight?.toFixed(1) ?? "—"}
            {latestWeight !== null && (
              <span className="text-sm text-dim font-normal ml-1">kg</span>
            )}
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-[11px] text-dim tracking-wider uppercase mb-2">
            BMI
          </div>
          <div className="text-2xl font-semibold font-[family-name:var(--font-geist-mono)]">
            {latestBMI?.toFixed(1) ?? "—"}
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-[11px] text-dim tracking-wider uppercase mb-2">
            체지방률
          </div>
          <div className="text-2xl font-semibold font-[family-name:var(--font-geist-mono)]">
            {latestBodyFat?.toFixed(1) ?? "—"}
            {latestBodyFat !== null && (
              <span className="text-sm text-dim font-normal ml-1">%</span>
            )}
          </div>
        </div>
      </div>

      {/* 추세 차트 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <TrendLineChart
          title="체중 추세 (30일)"
          data={weightTrend}
          color="#60a5fa"
          unit="kg"
        />
        {fatTrend.length > 0 && (
          <TrendLineChart
            title="체지방률 추세 (30일)"
            data={fatTrend}
            color="#a78bfa"
            unit="%"
          />
        )}
      </div>

      {/* 최근 기록 */}
      <div className="bg-card border border-border rounded-xl p-5">
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
        <p className="text-dim text-[12px] mb-4">간단히 기록하면 칼로리를 추정합니다</p>
        <FoodInput />
      </div>
    </div>
  );
}

function FoodInput() {
  const [desc, setDesc] = useState("");
  const [meal, setMeal] = useState("lunch");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<{ description: string; estimatedKcal: number; mealType: string }[]>([]);

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
                <span className="text-dim mr-2">{mealLabels[l.mealType] ?? l.mealType}</span>
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
