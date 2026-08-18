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
  // Codex P2 (릴리즈 PR #313 4/5/6회차): description save 성공 후 router.refresh() 가 SSR
  // 반영을 마치기 전 사용자가 kcal editor 를 열면 log.estimatedKcal 이 여전히 old value →
  // stale 값이 draft 로 복원돼 저장 시 새 desc 에 old kcal 적용.
  //
  // 해결: expectedDescription 을 저장, log.description 이 그 값으로 갱신되면 (실제 SSR
  // 반영) 자동 해제. render-time derive 라 setState-in-effect 룰 무관.
  //
  // fallback timer 는 제거 — RSC refresh 실패 / 30s 이상 pending 이면 timer 가 stale
  // prop 을 editable 로 만들어 회귀 발생. refresh 가 실패하는 극단 케이스에선 pending 이
  // 무한 남지만, kcal edit 을 잠근 채 사용자가 페이지 새로고침으로 회복하는 게 stale kcal
  // 을 새 desc 에 잘못 적용하는 것보다 안전.
  const [expectedDescription, setExpectedDescription] = useState<string | null>(null);
  const descPending =
    expectedDescription !== null && log.description !== expectedDescription;


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
      // Codex P2 (릴리즈 PR #311): description PATCH 는 서버에서 estimatedKcal 을 null 로
      // 리셋 (backfill 재추정 대기). router.refresh() 후 log.estimatedKcal 이 null 이지만
      // client component state 는 보존되어 kcalInput 이 이전 kcal 유지 → 이후 kcal 편집
      // 열면 stale 값 노출 · 저장 시 새 description 에 옛 kcal 적용됨. 초기화 필수.
      // Codex P2 (릴리즈 PR #313): kcal editor 가 열려있었다면 in-progress 값이 blank 로
      // silently discarded → 사용자 혼란. editor 자체를 닫아 상태 변경을 명시.
      // Codex P2 (릴리즈 PR #313 4/5회차): expected description 저장 → log.description 이
      // 새 값으로 갱신될 때까지 descPending 유지 (fixed timer 대신 실제 SSR 반영 감지).
      setEditingKcal(false);
      setKcalInput("");
      setExpectedDescription(trimmed);
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
              onClick={() => {
                // Codex P2 (릴리즈 PR #313): kcal editor 열 때 항상 최신 log.estimatedKcal
                // 로 draft 재초기화. description edit 이후 kcalInput 이 "" 로 리셋됐지만
                // backfill 이 새 kcal 을 채워둔 상태에서 editor 를 blank 로 열면 저장 시
                // PATCH { estimatedKcal: null } → 새로 추정된 값 파괴 회귀.
                setKcalInput(
                  log.estimatedKcal !== null ? String(log.estimatedKcal) : "",
                );
                setError(null);
                setEditingKcal(true);
              }}
              disabled={descPending}
              className="text-[11px] text-dim hover:text-bright underline disabled:opacity-40 disabled:cursor-not-allowed"
              title={descPending ? "설명 반영 중… 잠시 후 다시 시도" : "kcal 편집"}
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
