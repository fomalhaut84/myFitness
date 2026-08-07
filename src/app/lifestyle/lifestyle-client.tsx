"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import WeeklyActivitySummary from "@/components/lifestyle/WeeklyActivitySummary";
import MonthlyHeatmap from "@/components/lifestyle/MonthlyHeatmap";
import ConsistencyScore from "@/components/lifestyle/ConsistencyScore";
import SleepRegularity from "@/components/lifestyle/SleepRegularity";

interface WeekSummary {
  count: number;
  totalDistance: number;
  totalDuration: number;
  restDays: number;
}

interface SleepEntry {
  date: string;
  sleepStartHour: number;
  wakeUpHour: number;
}

interface FoodLogEntry {
  id: string;
  description: string;
  mealType: string | null;
  estimatedKcal: number | null;
  timeIso: string;
}

interface LifestyleClientProps {
  thisWeek: WeekSummary;
  lastWeek: WeekSummary;
  monthlyActiveDates: string[];
  year: number;
  month: number;
  consistencyActiveDays: number;
  sleepEntries: SleepEntry[];
  todayFoodLogs: FoodLogEntry[];
}

export default function LifestyleClient({
  thisWeek,
  lastWeek,
  monthlyActiveDates,
  year,
  month,
  consistencyActiveDays,
  sleepEntries,
  todayFoodLogs,
}: LifestyleClientProps) {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-1">생활 패턴</h1>
        <p className="text-dim text-sm">운동 꾸준함 · 수면 규칙성 분석</p>
      </div>

      {/* 이번 주 vs 지난 주 */}
      <div className="mb-6">
        <WeeklyActivitySummary thisWeek={thisWeek} lastWeek={lastWeek} />
      </div>

      {/* 꾸준함 + 수면 규칙성 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <ConsistencyScore activeDays={consistencyActiveDays} totalDays={28} />
        <SleepRegularity entries={sleepEntries} />
      </div>

      {/* 월간 히트맵 */}
      <MonthlyHeatmap
        year={year}
        month={month}
        activeDates={new Set(monthlyActiveDates)}
      />

      {/* #283: 오늘 음식 로그 */}
      <div className="mt-6">
        <TodayFoodSection logs={todayFoodLogs} />
      </div>
    </div>
  );
}

const MEAL_LABEL: Record<string, string> = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
};

function TodayFoodSection({ logs }: { logs: FoodLogEntry[] }) {
  const totalKcal = logs.reduce((s, l) => s + (l.estimatedKcal ?? 0), 0);
  const hasEstimate = logs.some((l) => l.estimatedKcal !== null);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold">
          오늘 음식
          <span className="text-[11px] text-dim font-normal ml-2">
            (AI 자동 kcal 추정)
          </span>
        </h2>
        {hasEstimate && (
          <span className="text-[13px] font-[family-name:var(--font-geist-mono)]">
            총 {totalKcal.toLocaleString("ko-KR")}
            <span className="text-dim ml-1">kcal</span>
          </span>
        )}
      </div>
      <div className="bg-card border border-border rounded-xl p-5">
        {logs.length === 0 ? (
          <div className="text-[13px] text-dim text-center py-6">
            오늘 기록된 음식이 없습니다. 텔레그램에서 &quot;점심 김치찌개 밥&quot; 처럼 입력하면 자동 기록됩니다.
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {logs.map((log) => (
              <FoodRow key={log.id} log={log} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FoodRow({ log }: { log: FoodLogEntry }) {
  const router = useRouter();
  const [editingKcal, setEditingKcal] = useState(false);
  const [kcalInput, setKcalInput] = useState(
    log.estimatedKcal !== null ? String(log.estimatedKcal) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveKcal() {
    if (saving) return;
    const trimmed = kcalInput.trim();
    const n = trimmed === "" ? null : parseInt(trimmed, 10);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 10000)) {
      setError("0~10000 사이 정수여야 합니다");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/food/${log.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ estimatedKcal: n }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `요청 실패 (${res.status})`);
      }
      setEditingKcal(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteRow() {
    if (saving) return;
    if (!confirm(`"${log.description}" 삭제할까요?`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/food/${log.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `요청 실패 (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  const label = log.mealType ? MEAL_LABEL[log.mealType] ?? log.mealType : "기타";
  const time = new Date(log.timeIso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <li className="py-3 flex items-start gap-3 text-[13px]">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[11px] text-dim">
            {time} · {label}
          </span>
        </div>
        <div className="text-bright break-words">{log.description}</div>
        {error && <div className="text-[11px] text-red-400 mt-1">{error}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {editingKcal ? (
          <>
            <input
              type="text"
              value={kcalInput}
              onChange={(e) => setKcalInput(e.target.value)}
              placeholder="kcal"
              className="w-20 bg-surface border border-border rounded px-2 py-1 text-[13px] text-right font-[family-name:var(--font-geist-mono)]"
            />
            <button
              type="button"
              onClick={saveKcal}
              disabled={saving}
              className="text-[11px] text-accent border border-accent/40 rounded px-2 py-1 hover:bg-accent/10 disabled:opacity-50"
            >
              저장
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingKcal(false);
                setKcalInput(log.estimatedKcal !== null ? String(log.estimatedKcal) : "");
                setError(null);
              }}
              className="text-[11px] text-dim border border-border rounded px-2 py-1"
            >
              취소
            </button>
          </>
        ) : (
          <>
            <span className="font-[family-name:var(--font-geist-mono)] tabular-nums">
              {log.estimatedKcal !== null
                ? log.estimatedKcal.toLocaleString("ko-KR")
                : "—"}
              <span className="text-dim ml-1 text-[11px]">kcal</span>
            </span>
            <button
              type="button"
              onClick={() => setEditingKcal(true)}
              className="text-[11px] text-dim hover:text-bright underline"
            >
              편집
            </button>
            <button
              type="button"
              onClick={deleteRow}
              disabled={saving}
              className="text-[11px] text-red-400/70 hover:text-red-400 disabled:opacity-50"
              title="삭제"
            >
              ×
            </button>
          </>
        )}
      </div>
    </li>
  );
}
