"use client";

// #299 (M14 Phase 2 #3): 매크로 도넛 (P/C/F kcal 비율).
// pure SVG · 최근 7일 avg vs 오늘 토글.

import { useState } from "react";

interface MacroValues {
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  // Codex P2 (PR #300 12회차): 저장된 kcal (estimator ±25% divergence 감안, macro-derived 로만
  // 계산하면 valid 2000 kcal 이 ~1500 으로 표시될 수 있음). 센터 표시에 사용, slice 비율은
  // macro-derived kcal 유지.
  kcal: number | null;
}

interface MacroDonutProps {
  weekly: MacroValues;
  today: MacroValues;
  bodyWeightKg: number | null;
}

const P_COLOR = "#22c55e";
const C_COLOR = "#38bdf8";
const F_COLOR = "#fbbf24";

// Codex P2 (PR #300 4회차): 하나라도 null 이면 슬라이스 비율 계산 불가 (?? 0 은 unknown 을 0 으로
// 취급해 다른 슬라이스가 100% 로 보임). slice 비율 산출용.
function macroDerivedKcal(m: MacroValues): number | null {
  if (m.proteinG === null || m.carbsG === null || m.fatG === null) return null;
  return m.proteinG * 4 + m.carbsG * 4 + m.fatG * 9;
}
function hasAnyMacro(m: MacroValues): boolean {
  return m.proteinG !== null || m.carbsG !== null || m.fatG !== null;
}

interface DonutSeg {
  value: number;
  color: string;
}

function Donut({ segments, size, thickness, children }: {
  segments: DonutSeg[];
  size: number;
  thickness: number;
  children?: React.ReactNode;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const gap = 2;
  // 각 세그먼트의 rotate 시작각 (누적) 을 사전 계산 — render 중 mutation 회피.
  const prefixSums: number[] = [];
  segments.reduce((acc, seg) => {
    prefixSums.push(acc);
    return acc + seg.value;
  }, 0);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={thickness} opacity="0.4" />
        {segments.map((seg, i) => {
          const frac = seg.value / total;
          const len = Math.max(0, frac * circ - gap);
          const dashArray = `${len} ${circ - len}`;
          const rotate = (prefixSums[i] / total) * 360 - 90;
          return (
            <circle
              key={i}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={thickness}
              strokeDasharray={dashArray}
              strokeLinecap="butt"
              transform={`rotate(${rotate} ${cx} ${cy})`}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        {children}
      </div>
    </div>
  );
}

const fmt1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);
const fmtG = (n: number | null): string => n == null ? "—" : `${Math.round(n)}g`;

export default function MacroDonut({ weekly, today, bodyWeightKg }: MacroDonutProps) {
  const [view, setView] = useState<"7d" | "today">("7d");
  const active = view === "7d" ? weekly : today;
  // Codex P2 (PR #300 12회차): 센터 라벨은 저장 kcal 우선 (macro-derived 는 ±25% 오차 가능).
  // slice 비율만 macro-derived 로 계산 — 시각적 비율 정확성 유지.
  const derivedKcal = macroDerivedKcal(active);
  const displayKcal = active.kcal ?? derivedKcal;
  const isPartial = derivedKcal === null && hasAnyMacro(active);
  const isEmpty = !hasAnyMacro(active) && active.kcal === null;
  // Codex P2 (PR #300 4회차): null 인 macro 는 세그먼트에 표시 안 함 (0 취급 X).
  // Codex P2 (PR #301 23회차): partial (예: P 만 있고 C/F null) 이면 남은 슬라이스가 total 로
  // 정규화되어 "100% 단백질" 원으로 오해. derivedKcal 이 null 이면 비율 자체가 무의미 →
  // 세그먼트를 전혀 렌더링 안 함 (빈 링 + "부분 미측정" 센터 라벨). complete tuple 일 때만
  // 실제 비율 표시.
  const segments: DonutSeg[] =
    derivedKcal !== null
      ? [
          { value: (active.proteinG as number) * 4, color: P_COLOR },
          { value: (active.carbsG as number) * 4, color: C_COLOR },
          { value: (active.fatG as number) * 9, color: F_COLOR },
        ]
      : [];
  const pKg = active.proteinG !== null && bodyWeightKg
    ? active.proteinG / bodyWeightKg
    : null;
  // pct 는 macro-derived total 기반 (slice 비율 정확).
  const pct = (kc: number): string =>
    derivedKcal !== null && derivedKcal > 0 ? ((kc / derivedKcal) * 100).toFixed(0) : "—";

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div className="text-[10px] tracking-[0.22em] uppercase text-dim font-[family-name:var(--font-geist-mono)]">Macros</div>
          <h2 className="text-[17px] font-semibold mt-0.5">P / C / F 밸런스</h2>
        </div>
        <div className="flex text-[11px] font-[family-name:var(--font-geist-mono)]">
          {(["7d","today"] as const).map((k) => (
            <button key={k} onClick={()=>setView(k)}
              className={`px-2.5 py-1 rounded-md tracking-wider ${view===k ? "bg-surface text-bright" : "text-dim hover:text-muted"}`}>
              {k === "7d" ? "7일 평균" : "오늘"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-5 items-center" style={{gridTemplateColumns:"minmax(0,180px) 1fr"}}>
        <div className="mx-auto">
          <Donut segments={segments} size={180} thickness={22}>
            <div className="text-[10px] tracking-[0.22em] uppercase text-dim font-[family-name:var(--font-geist-mono)]">Intake</div>
            <div className="text-[26px] font-semibold font-[family-name:var(--font-geist-mono)] tracking-tight text-bright">
              {/* Codex P2 (PR #301 20회차): 0 kcal 은 유효한 값 (물·다이어트 콜라). null 만 em dash. */}
              {displayKcal !== null ? Math.round(displayKcal).toLocaleString("ko") : "—"}
            </div>
            <div className="text-[11px] font-[family-name:var(--font-geist-mono)] text-dim">
              {isPartial ? "부분 미측정" : isEmpty ? `${view === "7d" ? "7일" : "오늘"} 기록 없음` : `kcal · ${view === "7d" ? "avg/day" : "today"}`}
            </div>
          </Donut>
        </div>
        <ul className="space-y-3">
          {[
            { label:"단백질", val:active.proteinG, kc:(active.proteinG ?? 0)*4, color:P_COLOR, extra: pKg !== null ? `${fmt1(pKg)} g/kg` : "" },
            { label:"탄수화물", val:active.carbsG, kc:(active.carbsG ?? 0)*4, color:C_COLOR, extra:"" },
            { label:"지방",   val:active.fatG,   kc:(active.fatG ?? 0)*9,   color:F_COLOR, extra:"" },
          ].map((r, i) => (
            <li key={i} className="grid items-baseline gap-3" style={{gridTemplateColumns:"10px 1fr auto"}}>
              <span className="w-[6px] h-[6px] rounded-sm translate-y-[3px]" style={{background:r.color}}></span>
              <div>
                <div className="text-[11px] tracking-wider uppercase text-dim">{r.label}</div>
                <div className="text-[15px] font-[family-name:var(--font-geist-mono)] text-bright">
                  {fmtG(r.val)}
                  {r.extra && <span className="ml-2 text-[11px] text-dim">{r.extra}</span>}
                </div>
              </div>
              <div className="text-[12px] font-[family-name:var(--font-geist-mono)] tabular-nums text-sub">{pct(r.kc)}%</div>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-4 pt-3 border-t border-border/60 text-[11px] font-[family-name:var(--font-geist-mono)] text-dim flex items-center gap-3">
        <span>1g P/C = 4 kcal · 1g F = 9 kcal</span>
        <span className="ml-auto">{bodyWeightKg ? `체중 ${fmt1(bodyWeightKg)} kg` : "체중 미측정"}</span>
      </div>
    </div>
  );
}
