"use client";

// #299: 오늘 식단 리스트. FoodLog 카드 · P/C/F g 병기 · 부분 미측정 뱃지.
// #322 (M14 Phase 3 #2): items breakdown 접기/펼치기. 비빔밥 + 계란국 저장 시 각각의
// kcal · P · C · F 세부 확인 가능. legacy row (items null) 는 토글 숨김.
// 사전 리뷰 P0: types/sanitize 는 순수 헬퍼 파일 (`@/lib/nutrition/food-items`) 로 분리해
// server component (page) 도 안전하게 import (client boundary 오염 방지).

import { useState } from "react";
import type { FoodItemBreakdown } from "@/lib/nutrition/food-items";

export interface NutritionFoodItem {
  id: string;
  timeIso: string;
  mealType: string | null;
  description: string;
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  /** estimator 산출 item breakdown. legacy row 는 null. */
  items?: FoodItemBreakdown[] | null;
}

interface Props {
  items: NutritionFoodItem[];
  /** #330: 헤더 라벨 커스터마이즈. 기본 "오늘 식단". 과거 날짜 시 "YYYY-MM-DD 식단". */
  headerLabel?: string;
  /** 빈 리스트 안내 문구. 오늘/과거로 톤 다름. */
  emptyLabel?: string;
  /** lifestyle 링크에 date 파라미터 전달용. 오늘이면 undefined. */
  lifestyleDateParam?: string;
}

const P_COLOR = "#22c55e";
const C_COLOR = "#38bdf8";
const F_COLOR = "#fbbf24";

const MEAL_LABEL: Record<string, string> = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
};

const fmtKcal = (n: number | null): string => n == null ? "—" : `${Math.round(n)}`;
const fmtG = (n: number | null): string => n == null ? "—" : `${Math.round(n)}g`;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function ItemBreakdownRow({ it }: { it: FoodItemBreakdown }) {
  return (
    <div className="pl-3 py-1.5 border-l-2 border-border/50">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-bright truncate">{it.name}</span>
        <span className="text-[12px] font-[family-name:var(--font-geist-mono)] tabular-nums text-muted shrink-0">
          {fmtKcal(it.kcal)}<span className="text-[10px] ml-0.5 text-dim">kcal</span>
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-0.5">
        {[
          { l: "P", v: it.proteinG, clr: P_COLOR },
          { l: "C", v: it.carbsG,   clr: C_COLOR },
          { l: "F", v: it.fatG,     clr: F_COLOR },
        ].map((m, i) => (
          <div key={i} className="flex items-baseline gap-1 text-[10px] font-[family-name:var(--font-geist-mono)]">
            <span className="w-1 h-1 rounded-sm" style={{ background: m.clr }}></span>
            <span className="text-dim">{m.l}</span>
            <span className="tabular-nums text-muted">{fmtG(m.v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FoodCard({ item }: { item: NutritionFoodItem }) {
  const [expanded, setExpanded] = useState(false);
  const missing =
    item.kcal == null ||
    item.proteinG == null ||
    item.carbsG == null ||
    item.fatG == null;
  const hasBreakdown = Array.isArray(item.items) && item.items.length > 0;
  // #322 Codex P2 (릴리즈 PR #325): items sum vs top-level kcal mismatch 뱃지.
  // estimator 는 tolerance max(30, 5%) 이내면 통과 → 저장 후 UI 확장 시 100 kcal top-level +
  // items 합 70 kcal 같은 시각 mismatch 가능. 사용자가 "정정된 총합" 임을 인지하도록 표시.
  // Codex P2 (PR #327): estimator (parseNutritionResponse) 는 Math.round(total * 0.05) 로
  // 계산하니 UI 도 동일하게. unrounded 5% 쓰면 610/579 (diff 31, estimator tol 31 통과) 를
  // UI 만 mismatch (tol 30.5) 로 오판정 → false positive 뱃지.
  const itemsKcalSum = hasBreakdown
    ? item.items!.reduce((s, it) => s + (it.kcal ?? 0), 0)
    : null;
  const kcalMismatch =
    itemsKcalSum !== null &&
    item.kcal !== null &&
    Math.abs(itemsKcalSum - item.kcal) > Math.max(30, Math.round(item.kcal * 0.05));
  return (
    <div
      className={`px-4 py-3 flex flex-col gap-1.5 ${
        missing
          ? "bg-[repeating-linear-gradient(45deg,transparent_0,transparent_8px,rgba(220,38,38,.04)_8px,rgba(220,38,38,.04)_9px)]"
          : ""
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-[family-name:var(--font-geist-mono)] tracking-widest uppercase text-dim">
            {item.mealType ? MEAL_LABEL[item.mealType] ?? item.mealType : ""}
          </span>
          <span className="text-[10px] font-[family-name:var(--font-geist-mono)] text-dim">{formatTime(item.timeIso)}</span>
          {missing && (
            <span className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider px-1.5 py-[1px] rounded"
              style={{ color: "#fcd34d", border: "1px solid rgba(245,158,11,.35)" }}>
              부분 미측정
            </span>
          )}
          {kcalMismatch && (
            <span
              className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider px-1.5 py-[1px] rounded"
              style={{ color: "#93c5fd", border: "1px solid rgba(59,130,246,.35)" }}
              title={`items 합 ${Math.round(itemsKcalSum!)} kcal ↔ 총합 ${item.kcal} kcal`}
            >
              총합 정정됨
            </span>
          )}
        </div>
        <div className="text-[14px] font-[family-name:var(--font-geist-mono)] tabular-nums text-bright">
          {fmtKcal(item.kcal)}<span className="text-[11px] ml-1 text-dim">kcal</span>
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[14px] leading-snug text-bright">{item.description}</div>
        {hasBreakdown && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="shrink-0 text-[11px] font-[family-name:var(--font-geist-mono)] text-sub hover:text-bright px-1.5 py-0.5 rounded border border-border/60 hover:border-muted transition-colors"
          >
            {expanded ? "접기 ▴" : `세부 ${item.items!.length}개 ▾`}
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-1">
        {[
          { l: "P", v: item.proteinG, clr: P_COLOR },
          { l: "C", v: item.carbsG,   clr: C_COLOR },
          { l: "F", v: item.fatG,     clr: F_COLOR },
        ].map((m, i) => (
          <div key={i} className="flex items-baseline gap-1.5 text-[11px] font-[family-name:var(--font-geist-mono)]">
            <span className="w-1.5 h-1.5 rounded-sm" style={{ background: m.clr }}></span>
            <span className="text-dim">{m.l}</span>
            <span className="tabular-nums text-muted">{fmtG(m.v)}</span>
          </div>
        ))}
      </div>
      {expanded && hasBreakdown && (
        <div className="mt-2 flex flex-col gap-1.5">
          {item.items!.map((it, i) => (
            <ItemBreakdownRow key={i} it={it} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function NutritionFoodList({
  items,
  headerLabel,
  emptyLabel,
  lifestyleDateParam,
}: Props) {
  const missingCount = items.filter((i) =>
    i.kcal == null || i.proteinG == null || i.carbsG == null || i.fatG == null,
  ).length;
  const measuredKcal = items.filter((i) => i.kcal != null).reduce((s, i) => s + (i.kcal ?? 0), 0);
  const label = headerLabel ?? "오늘 식단";
  const empty = emptyLabel ?? "오늘 기록된 식단이 없습니다.";

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
        <div>
          <div className="text-[10px] tracking-[0.22em] uppercase text-dim font-[family-name:var(--font-geist-mono)]">Day</div>
          <h2 className="text-[17px] font-semibold mt-0.5">{label} · {items.length}건</h2>
        </div>
        <div className="text-[11px] font-[family-name:var(--font-geist-mono)] text-dim">
          {missingCount > 0 && <span className="mr-2" style={{ color: "#fcd34d" }}>미측정 {missingCount}</span>}
          <span>{measuredKcal.toLocaleString("ko")} kcal</span>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="text-[13px] text-dim text-center py-6">{empty}</div>
      ) : (
        <div>
          {items.map((i, idx) => (
            <div key={i.id} style={{ borderTop: idx === 0 ? "none" : "1px solid var(--border)" }}>
              <FoodCard item={i} />
            </div>
          ))}
        </div>
      )}
      <div className="px-4 py-3 border-t border-border/60 text-[11px] font-[family-name:var(--font-geist-mono)] text-dim flex items-center gap-3">
        <span>봇 · 웹 어느 쪽으로 입력해도 자동 추정</span>
        <a
          className="ml-auto text-sub hover:text-bright"
          href={lifestyleDateParam ? `/lifestyle?date=${lifestyleDateParam}` : "/lifestyle"}
        >
          {lifestyleDateParam ? `${lifestyleDateParam} 편집 →` : "/lifestyle 보기 →"}
        </a>
      </div>
    </div>
  );
}
