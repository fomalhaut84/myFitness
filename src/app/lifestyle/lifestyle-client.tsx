"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import WeeklyActivitySummary from "@/components/lifestyle/WeeklyActivitySummary";
import MonthlyHeatmap from "@/components/lifestyle/MonthlyHeatmap";
import ConsistencyScore from "@/components/lifestyle/ConsistencyScore";
import SleepRegularity from "@/components/lifestyle/SleepRegularity";
import FoodPhotoUpload from "@/components/lifestyle/FoodPhotoUpload";

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
  // Codex P2 (#283): null 항목이 있으면 총합을 완전한 하루 총량으로 오해할 수 있음.
  // "총" 대신 "부분 합계" + "N개 추정 대기" 라벨 표시.
  const missingCount = logs.filter((l) => l.estimatedKcal === null).length;
  const isPartial = missingCount > 0;
  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <h2 className="text-lg font-semibold">
          오늘 음식
          <span className="text-[11px] text-dim font-normal ml-2">
            (AI 자동 kcal 추정)
          </span>
        </h2>
        <div className="flex items-center gap-3">
          {hasEstimate && (
            <span className="text-[13px] font-[family-name:var(--font-geist-mono)]">
              {isPartial ? "부분 합계" : "총"} {totalKcal.toLocaleString("ko-KR")}
              <span className="text-dim ml-1">kcal</span>
              {isPartial && (
                <span className="text-dim ml-2 text-[11px]">
                  ({missingCount}개 추정 대기)
                </span>
              )}
            </span>
          )}
          {/* #309: 사진 등록 버튼 (Vision 자동 추정). */}
          <FoodPhotoUpload />
        </div>
      </div>
      <div className="bg-card border border-border rounded-xl p-5">
        {logs.length === 0 ? (
          <div className="text-[13px] text-dim text-center py-6">
            오늘 기록된 음식이 없습니다.<br />
            텔레그램에서 &quot;점심 김치찌개 밥&quot; 입력 or 위 <b>📷 사진 등록</b> 버튼으로 자동 기록.
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
  // #309: description 정정 인라인 편집.
  const [editingDesc, setEditingDesc] = useState(false);
  const [descInput, setDescInput] = useState(log.description);
  const [kcalInput, setKcalInput] = useState(
    log.estimatedKcal !== null ? String(log.estimatedKcal) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveDesc() {
    if (saving) return;
    const trimmed = descInput.trim();
    if (trimmed.length === 0) {
      setError("설명은 비워둘 수 없습니다");
      return;
    }
    if (trimmed.length > 500) {
      setError("설명은 500자 이내여야 합니다");
      return;
    }
    if (trimmed === log.description) {
      // no-op — 편집 종료.
      setEditingDesc(false);
      setError(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/food/${log.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `요청 실패 (${res.status})`);
      }
      setEditingDesc(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveKcal() {
    if (saving) return;
    const trimmed = kcalInput.trim();
    let n: number | null;
    if (trimmed === "") {
      n = null;
    } else {
      // Codex P2: parseInt('650.5') = 650 처럼 잘라먹지 않도록 전체 문자열이 정수여야 통과.
      if (!/^\d+$/.test(trimmed)) {
        setError("0~10000 사이 정수여야 합니다");
        return;
      }
      n = Number(trimmed);
      if (!Number.isInteger(n) || n < 0 || n > 10000) {
        setError("0~10000 사이 정수여야 합니다");
        return;
      }
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
  // Codex P2 (#283): 섹션 자체가 KST 기준으로 선택되므로 시각도 KST 로 고정.
  // UTC 서버 SSR / 다른 TZ 브라우저 hydration mismatch 방지.
  const time = new Date(log.timeIso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  });

  return (
    <li className="py-3 flex items-start gap-3 text-[13px]">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[11px] text-dim">
            {time} · {label}
          </span>
        </div>
        {editingDesc ? (
          <div className="flex items-center gap-2 mt-1">
            <input
              type="text"
              value={descInput}
              onChange={(e) => setDescInput(e.target.value)}
              placeholder="예: 치킨 샐러드 · 감자튀김"
              className="flex-1 bg-surface border border-muted rounded px-2 py-1 text-[13px] text-bright"
              autoFocus
            />
            <button
              type="button"
              onClick={saveDesc}
              disabled={saving}
              className="text-[11px] text-accent border border-accent/40 rounded px-2 py-1 hover:bg-accent/10 disabled:opacity-50"
            >
              저장
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingDesc(false);
                setDescInput(log.description);
                setError(null);
              }}
              className="text-[11px] text-dim border border-border rounded px-2 py-1"
            >
              취소
            </button>
          </div>
        ) : (
          <div className="text-bright break-words">{log.description}</div>
        )}
        {editingDesc && (
          <div className="text-[11px] text-dim mt-1">
            설명 변경 시 kcal/매크로가 자동 재추정됩니다.
          </div>
        )}
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
              title="kcal 편집"
            >
              편집
            </button>
            {/* #309: description 정정 버튼. */}
            <button
              type="button"
              onClick={() => {
                setEditingDesc(true);
                setDescInput(log.description);
                setError(null);
              }}
              className="text-[11px] text-dim hover:text-bright"
              title="설명 편집"
            >
              📝
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
