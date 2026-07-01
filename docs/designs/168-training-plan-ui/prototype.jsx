/**
 * 트레이닝 플랜 페이지 프로토타입 — "Coach's Ledger" (Athletic Editorial Dark)
 *
 * 톤: 러닝 매거진 스프레드 + 트레이닝 로그북. Big Shoulders Display + Instrument Serif +
 *     Pretendard + JetBrains Mono. Safety-orange accent + Zone-graded intensity colors.
 *
 * 이 파일은 참조용 프로토타입입니다. 실제 구현 시 API 통합 + 상태 관리 + 컴포넌트 분할.
 * 데이터는 M6-1 (get_active_training_plan) + M6-4 (recommend_today_workout) 실제 응답
 * 형태를 그대로 mock 합니다.
 */

"use client";

import { useState } from "react";

// ─── 컬러 시스템 ─────────────────────────────────────────────────────────────
const C = {
  bg: "#0B0B0D",
  panel: "#151517",
  panelHi: "#1B1B1E",
  border: "#26262A",
  hi: "#F0EBE0",
  mid: "#B4AFA5",
  lo: "#6B6560",
  muted: "#3A3833",
  primary: "#FF6B00",
  completed: "#8FB65E",
  missed: "#8B4A3F",
  z1: "#5A9CE0",
  z2: "#8FB65E",
  z34: "#F5B324",
  z5: "#FF6B00",
};

const ZONE_COLOR = {
  Z1: C.z1,
  Z2: C.z2,
  "Z3-4": C.z34,
  Z5: C.z5,
};

const TYPE_LABEL_KO = {
  easy: "이지",
  long: "롱런",
  tempo: "템포",
  interval: "인터벌",
  recovery: "회복",
  rest: "휴식",
};

// ─── Mock 데이터 (실제 API 응답 형태) ────────────────────────────────────────
const MOCK_TODAY = {
  date: "2026-07-01",
  base: {
    source: "plan",
    type: "tempo",
    distanceKm: 6.5,
    pace: "4:59",
    zone: "Z3-4",
    planId: "clx7abc",
  },
  recommendation: {
    type: "easy",
    distanceKm: 6.5,
    paceRange: { min: "5:25", max: "5:59" },
    zone: "Z2",
    adjusted: true,
    adjustmentReason: "readiness fatigued + 부상 위험 elevated",
  },
  factors: {
    readiness: { score: 45, label: "fatigued" },
    injury: { score: 42, label: "elevated" },
    plan: {
      hasActivePlan: true,
      todayWorkoutExists: true,
      todayIsRestPlanned: false,
      lthrPaceSource: "profile",
    },
  },
  rationale:
    "readiness 45 (fatigued) + 부상 위험 42 (elevated) → 계획된 tempo 를 easy 로 완화.",
};

const MOCK_PLAN = {
  plan: {
    planId: "clx7abc",
    startDate: "2026-06-15",
    endDate: "2026-07-12",
    weeklyFrequency: 4,
    targetDistance: "10K",
    targetDate: "2026-07-12",
  },
  progress: { total: 15, completed: 8, missed: 1, pending: 6, completionPct: 53.3 },
  workouts: buildMockWorkouts(),
};

function buildMockWorkouts() {
  // 4주 × 요일. 실제 셀 데이터는 date + type + status + 옵션.
  const days = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const week1 = [
    { day: "MON", type: "rest", status: "rest" },
    { day: "TUE", type: "easy", distanceKm: 6.5, pace: "5:42", zone: "Z2", status: "completed", matched: { distanceKm: 6.42, actualPace: "5:38" } },
    { day: "WED", type: "easy", distanceKm: 4.9, pace: "5:42", zone: "Z2", status: "completed", matched: { distanceKm: 5.02, actualPace: "5:45" } },
    { day: "THU", type: "tempo", distanceKm: 6.5, pace: "4:59", zone: "Z3-4", status: "completed", matched: { distanceKm: 6.60, actualPace: "5:02" } },
    { day: "FRI", type: "rest", status: "rest" },
    { day: "SAT", type: "long", distanceKm: 11.4, pace: "5:48", zone: "Z2", status: "completed", matched: { distanceKm: 11.20, actualPace: "5:51" } },
    { day: "SUN", type: "rest", status: "rest" },
  ];
  const week2 = [
    { day: "MON", type: "rest", status: "rest" },
    { day: "TUE", type: "easy", distanceKm: 7.1, pace: "5:42", zone: "Z2", status: "completed", matched: { distanceKm: 7.05, actualPace: "5:39" } },
    { day: "WED", type: "easy", distanceKm: 5.4, pace: "5:42", zone: "Z2", status: "completed", matched: { distanceKm: 5.40, actualPace: "5:44" } },
    { day: "THU", type: "tempo", distanceKm: 7.1, pace: "4:59", zone: "Z3-4", status: "missed" },
    { day: "FRI", type: "rest", status: "rest" },
    { day: "SAT", type: "long", distanceKm: 12.6, pace: "5:48", zone: "Z2", status: "completed", matched: { distanceKm: 12.4, actualPace: "5:50" } },
    { day: "SUN", type: "rest", status: "rest" },
  ];
  const week3 = [
    { day: "MON", type: "rest", status: "rest" },
    { day: "TUE", type: "easy", distanceKm: 7.8, pace: "5:42", zone: "Z2", status: "completed", matched: { distanceKm: 7.72, actualPace: "5:36" } },
    { day: "WED", type: "easy", distanceKm: 5.9, pace: "5:42", zone: "Z2", status: "completed", matched: { distanceKm: 5.85, actualPace: "5:41" } },
    { day: "THU", type: "tempo", distanceKm: 6.5, pace: "4:59", zone: "Z3-4", status: "today" },
    { day: "FRI", type: "rest", status: "rest" },
    { day: "SAT", type: "long", distanceKm: 13.8, pace: "5:48", zone: "Z2", status: "pending" },
    { day: "SUN", type: "rest", status: "rest" },
  ];
  const week4 = [
    { day: "MON", type: "easy", distanceKm: 3.6, pace: "5:42", zone: "Z2", status: "pending", taper: true },
    { day: "TUE", type: "easy", distanceKm: 2.4, pace: "5:42", zone: "Z2", status: "pending", taper: true },
    { day: "WED", type: "rest", status: "rest" },
    { day: "THU", type: "easy", distanceKm: 1.2, pace: "5:42", zone: "Z2", status: "pending", taper: true },
    { day: "FRI", type: "rest", status: "rest" },
    { day: "SAT", type: "rest", status: "rest" },
    { day: "SUN", type: "rest", status: "race", isRaceDay: true, notes: "10K 당일" },
  ];
  return { week1, week2, week3, week4, dayHeaders: days };
}

const MOCK_ARCHIVED = [
  { planId: "cly4xyz", startDate: "2026-05-18", endDate: "2026-06-14", weeklyFrequency: 4, targetDistance: null, completionPct: 62.5 },
  { planId: "clw9def", startDate: "2026-04-20", endDate: "2026-05-17", weeklyFrequency: 3, targetDistance: "5K", completionPct: 83.3 },
  { planId: "clv2ghi", startDate: "2026-03-23", endDate: "2026-04-19", weeklyFrequency: 4, targetDistance: "10K", completionPct: 75.0 },
];

// ─── 유틸 컴포넌트 ───────────────────────────────────────────────────────────

/** UPPERCASE 트래킹된 마이크로 라벨. */
function MicroLabel({ children, color = C.lo, className = "" }) {
  return (
    <span
      className={`inline-block ${className}`}
      style={{
        fontFamily: "Pretendard, ui-sans-serif",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color,
      }}
    >
      {children}
    </span>
  );
}

/** 매거진 섹션 번호 + 이탤릭 세리프 라벨. */
function SectionHeader({ number, kicker, title, meta }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/5 pb-4 mb-8">
      <div className="flex items-baseline gap-5">
        <span
          style={{
            fontFamily: '"Big Shoulders Display", ui-sans-serif',
            fontWeight: 800,
            fontSize: 68,
            lineHeight: 0.9,
            color: C.primary,
            letterSpacing: "-0.02em",
          }}
        >
          {number}
        </span>
        <div className="flex flex-col">
          <span
            style={{
              fontFamily: '"Instrument Serif", ui-serif',
              fontStyle: "italic",
              fontSize: 14,
              color: C.mid,
            }}
          >
            {kicker}
          </span>
          <span
            style={{
              fontFamily: '"Big Shoulders Display", ui-sans-serif',
              fontWeight: 700,
              fontSize: 32,
              lineHeight: 1,
              color: C.hi,
              letterSpacing: "-0.01em",
              textTransform: "uppercase",
            }}
          >
            {title}
          </span>
        </div>
      </div>
      {meta && (
        <span
          style={{
            fontFamily: '"JetBrains Mono", ui-monospace',
            fontSize: 12,
            color: C.lo,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {meta}
        </span>
      )}
    </div>
  );
}

/** 데이터 표시 유닛 (label + value). */
function DataUnit({ label, value, unit, color = C.hi, size = "md" }) {
  const sizeMap = {
    sm: { v: 20, l: 10 },
    md: { v: 32, l: 11 },
    lg: { v: 56, l: 12 },
    xl: { v: 84, l: 13 },
  };
  const s = sizeMap[size];
  return (
    <div className="flex flex-col gap-1">
      <MicroLabel color={C.lo}>{label}</MicroLabel>
      <div className="flex items-baseline gap-1.5">
        <span
          style={{
            fontFamily: '"Big Shoulders Display", ui-sans-serif',
            fontWeight: 700,
            fontSize: s.v,
            lineHeight: 0.9,
            color,
            letterSpacing: "-0.02em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </span>
        {unit && (
          <span
            style={{
              fontFamily: '"Pretendard", ui-sans-serif',
              fontSize: s.v * 0.28,
              fontWeight: 500,
              color: C.lo,
            }}
          >
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

/** 상태 라벨 (completed / missed / pending / rest). */
function StatusChip({ status }) {
  const map = {
    completed: { text: "완료", bg: `${C.completed}22`, fg: C.completed },
    missed: { text: "누락", bg: `${C.missed}33`, fg: C.missed },
    pending: { text: "예정", bg: `${C.mid}22`, fg: C.mid },
    rest: { text: "휴식", bg: "transparent", fg: C.lo },
    today: { text: "오늘", bg: `${C.primary}22`, fg: C.primary },
    race: { text: "레이스", bg: `${C.primary}`, fg: C.hi },
  };
  const cfg = map[status] || map.pending;
  return (
    <span
      style={{
        fontFamily: '"Pretendard", ui-sans-serif',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        padding: "3px 8px",
        borderRadius: 2,
        background: cfg.bg,
        color: cfg.fg,
      }}
    >
      {cfg.text}
    </span>
  );
}

// ─── 섹션 01: TODAY ─────────────────────────────────────────────────────────

function TodayWorkoutCard({ today }) {
  const { base, recommendation, factors, rationale } = today;
  const isRest = recommendation.type === "rest";

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-0 rounded-sm"
      style={{
        border: `1px solid ${C.border}`,
        background: `linear-gradient(180deg, ${C.panelHi} 0%, ${C.panel} 100%)`,
      }}
    >
      {/* Left: Hero — 조정된 워크아웃 */}
      <div
        className="p-8 md:p-10 relative overflow-hidden"
        style={{
          borderRight: `1px solid ${C.border}`,
          background: `radial-gradient(ellipse at top left, ${C.primary}0A 0%, transparent 60%)`,
        }}
      >
        {/* 좌상단 kicker */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: C.primary }}
            />
            <MicroLabel color={C.primary}>오늘 · {today.date}</MicroLabel>
          </div>
          {recommendation.adjusted && (
            <span
              style={{
                fontFamily: '"Instrument Serif", ui-serif',
                fontStyle: "italic",
                fontSize: 12,
                color: C.mid,
              }}
            >
              — 계획에서 조정됨
            </span>
          )}
        </div>

        {/* Hero: 타입 + 거리 */}
        <div className="mb-8">
          <div
            style={{
              fontFamily: '"Pretendard", ui-sans-serif',
              fontSize: 14,
              fontWeight: 500,
              color: C.mid,
              marginBottom: 4,
            }}
          >
            추천 워크아웃
          </div>
          <div className="flex items-end gap-4 mb-2">
            <span
              style={{
                fontFamily: '"Big Shoulders Display", ui-sans-serif',
                fontSize: 96,
                fontWeight: 800,
                lineHeight: 0.85,
                color: C.hi,
                letterSpacing: "-0.03em",
                textTransform: "uppercase",
              }}
            >
              {isRest ? "REST" : TYPE_LABEL_KO[recommendation.type]}
            </span>
            {recommendation.zone && (
              <span
                className="mb-3 px-2.5 py-1"
                style={{
                  fontFamily: '"JetBrains Mono", ui-monospace',
                  fontSize: 12,
                  fontWeight: 600,
                  color: ZONE_COLOR[recommendation.zone],
                  border: `1px solid ${ZONE_COLOR[recommendation.zone]}44`,
                  background: `${ZONE_COLOR[recommendation.zone]}11`,
                  letterSpacing: "0.05em",
                }}
              >
                {recommendation.zone}
              </span>
            )}
          </div>
        </div>

        {/* Metrics row */}
        {!isRest && (
          <div className="grid grid-cols-3 gap-6 pt-6 border-t" style={{ borderColor: C.border }}>
            <DataUnit label="Distance" value={recommendation.distanceKm} unit="km" size="lg" />
            <DataUnit
              label="Pace range"
              value={`${recommendation.paceRange.min}–${recommendation.paceRange.max}`}
              unit="/km"
              size="md"
              color={ZONE_COLOR[recommendation.zone]}
            />
            <DataUnit label="Zone" value={recommendation.zone} size="lg" color={ZONE_COLOR[recommendation.zone]} />
          </div>
        )}

        {/* Rationale */}
        <div
          className="mt-8 p-5"
          style={{
            background: "#0000001a",
            borderLeft: `2px solid ${C.primary}`,
          }}
        >
          <MicroLabel color={C.lo} className="mb-2">Rationale · 근거</MicroLabel>
          <p
            style={{
              fontFamily: '"Instrument Serif", ui-serif',
              fontStyle: "italic",
              fontSize: 18,
              lineHeight: 1.5,
              color: C.hi,
              marginTop: 6,
            }}
          >
            &ldquo;{rationale}&rdquo;
          </p>
        </div>

        {/* Base 비교 */}
        {recommendation.adjusted && !isRest && (
          <div
            className="mt-6 flex items-baseline gap-3 flex-wrap"
            style={{ color: C.mid, fontFamily: '"Pretendard"', fontSize: 13 }}
          >
            <MicroLabel color={C.lo}>계획된 workout</MicroLabel>
            <span
              style={{
                fontFamily: '"JetBrains Mono"',
                textDecoration: "line-through",
                textDecorationColor: C.missed,
              }}
            >
              {TYPE_LABEL_KO[base.type]} · {base.distanceKm} km · {base.pace}/km · {base.zone}
            </span>
          </div>
        )}
      </div>

      {/* Right: Factors */}
      <div className="p-8 md:p-10 flex flex-col gap-6">
        <div>
          <MicroLabel color={C.lo}>결정 팩터</MicroLabel>
          <div
            style={{
              fontFamily: '"Big Shoulders Display"',
              fontSize: 24,
              fontWeight: 700,
              color: C.hi,
              textTransform: "uppercase",
              marginTop: 4,
            }}
          >
            Signals
          </div>
        </div>

        <FactorRow
          label="Readiness"
          score={factors.readiness.score}
          maxScore={100}
          statusLabel={factors.readiness.label}
          tone="fatigued"
        />
        <FactorRow
          label="Injury Risk"
          score={factors.injury.score}
          maxScore={100}
          statusLabel={factors.injury.label}
          tone="elevated"
          higherIsWorse
        />

        <div
          className="mt-2 p-4"
          style={{
            border: `1px solid ${C.border}`,
            background: C.panel,
          }}
        >
          <MicroLabel color={C.lo}>Plan context</MicroLabel>
          <div className="mt-3 space-y-1.5" style={{ fontFamily: '"JetBrains Mono"', fontSize: 12, color: C.mid }}>
            <div className="flex justify-between">
              <span>Active plan</span>
              <span style={{ color: factors.plan.hasActivePlan ? C.completed : C.missed }}>
                {factors.plan.hasActivePlan ? "yes" : "no"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Today workout row</span>
              <span style={{ color: factors.plan.todayWorkoutExists ? C.completed : C.lo }}>
                {factors.plan.todayWorkoutExists ? "yes" : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Rest planned</span>
              <span style={{ color: factors.plan.todayIsRestPlanned ? C.mid : C.lo }}>
                {factors.plan.todayIsRestPlanned ? "yes" : "no"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>LTHR source</span>
              <span style={{ color: C.hi }}>{factors.plan.lthrPaceSource}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FactorRow({ label, score, maxScore, statusLabel, tone, higherIsWorse }) {
  // score 색: readiness 는 낮을수록 위험 (fatigued/depleted → red). injury 는 높을수록 위험.
  const pct = Math.round((score / maxScore) * 100);
  const isBad = higherIsWorse
    ? score >= 50
    : score < 50;
  const barColor = isBad ? C.missed : C.completed;
  const scoreColor = isBad ? C.missed : C.completed;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-baseline gap-3">
          <MicroLabel color={C.mid}>{label}</MicroLabel>
          <span
            style={{
              fontFamily: '"Pretendard"',
              fontSize: 11,
              color: barColor,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            · {statusLabel}
          </span>
        </div>
        <span
          style={{
            fontFamily: '"Big Shoulders Display"',
            fontSize: 32,
            fontWeight: 700,
            color: scoreColor,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {score}
        </span>
      </div>
      <div className="h-1 rounded-none" style={{ background: C.muted }}>
        <div
          className="h-full transition-all duration-700 ease-out"
          style={{
            width: `${pct}%`,
            background: barColor,
          }}
        />
      </div>
    </div>
  );
}

// ─── 섹션 02: THIS BLOCK (4주 캘린더) ───────────────────────────────────────

function ProgressStrip({ progress }) {
  const { completed, missed, pending, total, completionPct } = progress;
  const c = (completed / total) * 100;
  const m = (missed / total) * 100;
  return (
    <div className="mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-baseline gap-6">
          <div className="flex items-baseline gap-2">
            <span style={{ fontFamily: '"Big Shoulders Display"', fontSize: 48, fontWeight: 800, color: C.hi, lineHeight: 0.85, fontVariantNumeric: "tabular-nums" }}>
              {completionPct}
            </span>
            <span style={{ fontFamily: '"Pretendard"', fontSize: 18, color: C.mid, fontWeight: 500 }}>%</span>
          </div>
          <span style={{ fontFamily: '"Instrument Serif"', fontStyle: "italic", fontSize: 14, color: C.mid }}>
            block completion
          </span>
        </div>
        <div className="flex gap-5 text-xs" style={{ fontFamily: '"JetBrains Mono"', color: C.mid }}>
          <span><span style={{ color: C.completed }}>■</span> {completed} 완료</span>
          <span><span style={{ color: C.missed }}>■</span> {missed} 누락</span>
          <span><span style={{ color: C.mid }}>■</span> {pending} 예정</span>
        </div>
      </div>
      <div className="h-1.5 flex" style={{ background: C.muted }}>
        <div style={{ width: `${c}%`, background: C.completed }} className="transition-all duration-700" />
        <div style={{ width: `${m}%`, background: C.missed }} className="transition-all duration-700" />
      </div>
    </div>
  );
}

function CalendarCell({ cell, isToday }) {
  const { type, distanceKm, pace, zone, status, matched, notes, isRaceDay } = cell;
  const isRest = type === "rest";
  const isMissed = status === "missed";
  const isCompleted = status === "completed";
  const zColor = zone ? ZONE_COLOR[zone] : null;

  const cellStyle = {
    borderTop: `1px solid ${isToday ? C.primary : C.border}`,
    background: isToday ? `${C.primary}0A` : "transparent",
    outline: isToday ? `1.5px solid ${C.primary}` : "none",
    outlineOffset: -1,
    opacity: isRest ? 0.42 : 1,
    minHeight: 96,
  };

  if (isRest && !isRaceDay) {
    return (
      <div className="p-3 relative" style={cellStyle}>
        <MicroLabel color={C.lo}>{TYPE_LABEL_KO.rest}</MicroLabel>
        {isToday && (
          <div className="absolute bottom-2 left-3 text-[9px] font-semibold" style={{ color: C.primary, letterSpacing: "0.14em" }}>
            TODAY
          </div>
        )}
      </div>
    );
  }

  if (isRaceDay) {
    return (
      <div
        className="p-3 relative"
        style={{
          ...cellStyle,
          background: C.primary,
          opacity: 1,
          borderTop: `2px solid ${C.primary}`,
        }}
      >
        <div style={{ fontFamily: '"Big Shoulders Display"', fontSize: 22, fontWeight: 800, color: C.hi, letterSpacing: "-0.01em", textTransform: "uppercase" }}>
          RACE
        </div>
        <div style={{ fontFamily: '"Pretendard"', fontSize: 10, color: `${C.hi}cc`, marginTop: 2 }}>
          {notes}
        </div>
      </div>
    );
  }

  return (
    <div
      className="p-3 relative group cursor-default"
      style={cellStyle}
    >
      {/* 타입 이름 */}
      <div className="flex items-baseline justify-between mb-1">
        <span
          style={{
            fontFamily: '"Big Shoulders Display"',
            fontSize: 16,
            fontWeight: 700,
            color: isMissed ? C.missed : isCompleted ? C.completed : C.hi,
            textTransform: "uppercase",
            letterSpacing: "-0.005em",
            textDecoration: isMissed ? "line-through" : "none",
          }}
        >
          {TYPE_LABEL_KO[type]}
        </span>
        {zone && (
          <span
            style={{
              fontFamily: '"JetBrains Mono"',
              fontSize: 9,
              fontWeight: 600,
              color: zColor,
              padding: "1px 4px",
              border: `1px solid ${zColor}55`,
              lineHeight: 1.3,
            }}
          >
            {zone}
          </span>
        )}
      </div>

      {/* 거리 + 페이스 */}
      <div className="flex items-baseline gap-1.5 mb-1">
        <span
          style={{
            fontFamily: '"Big Shoulders Display"',
            fontSize: 28,
            fontWeight: 800,
            color: C.hi,
            lineHeight: 0.9,
            fontVariantNumeric: "tabular-nums",
            textDecoration: isMissed ? "line-through" : "none",
            textDecorationColor: C.missed,
          }}
        >
          {distanceKm}
        </span>
        <span style={{ fontFamily: '"Pretendard"', fontSize: 10, color: C.lo, fontWeight: 500 }}>
          km
        </span>
      </div>
      <div
        style={{
          fontFamily: '"JetBrains Mono"',
          fontSize: 10,
          color: C.mid,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {pace}/km
      </div>

      {/* Matched activity */}
      {matched && (
        <div
          className="mt-2 pt-2 flex items-baseline gap-2"
          style={{
            borderTop: `1px dashed ${C.completed}33`,
            fontFamily: '"JetBrains Mono"',
            fontSize: 10,
            color: C.completed,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span>→</span>
          <span>{matched.distanceKm} km · {matched.actualPace}</span>
        </div>
      )}

      {/* 상태 인디케이터 (오늘/누락은 상단 인디케이터) */}
      {isToday && (
        <div className="absolute top-2 right-2 text-[9px] font-semibold" style={{ color: C.primary, letterSpacing: "0.14em" }}>
          TODAY
        </div>
      )}
    </div>
  );
}

function WeekRow({ weekLabel, weekTotalKm, cells, isCurrentWeek, todayDate, weekStartOffset, planStart }) {
  return (
    <div className="grid grid-cols-[80px_1fr_60px] items-stretch" style={{ borderBottom: `1px solid ${C.border}` }}>
      {/* 좌: 주 라벨 */}
      <div
        className="p-4 flex flex-col justify-between"
        style={{
          background: isCurrentWeek ? `${C.primary}08` : "transparent",
          borderRight: `1px solid ${C.border}`,
        }}
      >
        <div>
          <MicroLabel color={C.lo}>Week</MicroLabel>
          <div
            style={{
              fontFamily: '"Big Shoulders Display"',
              fontSize: 42,
              fontWeight: 800,
              color: isCurrentWeek ? C.primary : C.hi,
              lineHeight: 0.85,
              marginTop: 2,
            }}
          >
            {weekLabel}
          </div>
        </div>
        {isCurrentWeek && (
          <MicroLabel color={C.primary}>current</MicroLabel>
        )}
      </div>

      {/* 중: 7일 셀 */}
      <div className="grid grid-cols-7">
        {cells.map((cell, idx) => {
          const isTodayCell = isCurrentWeek && idx === 1; // Tue in Wk3 = today (mock)
          return <CalendarCell key={idx} cell={cell} isToday={isTodayCell} />;
        })}
      </div>

      {/* 우: 주간 총계 */}
      <div
        className="p-4 flex flex-col items-end justify-center"
        style={{ borderLeft: `1px solid ${C.border}` }}
      >
        <MicroLabel color={C.lo}>Vol</MicroLabel>
        <span
          style={{
            fontFamily: '"Big Shoulders Display"',
            fontSize: 24,
            fontWeight: 700,
            color: C.hi,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
            marginTop: 2,
          }}
        >
          {weekTotalKm}
        </span>
        <span style={{ fontFamily: '"Pretendard"', fontSize: 9, color: C.lo }}>km</span>
      </div>
    </div>
  );
}

function PlanCalendar({ plan }) {
  const w = plan.workouts;
  const sum = (cells) => cells.reduce((s, c) => s + (c.distanceKm || 0), 0).toFixed(1);
  return (
    <div style={{ border: `1px solid ${C.border}`, background: C.panel }}>
      {/* 요일 헤더 */}
      <div className="grid grid-cols-[80px_1fr_60px]" style={{ background: "#00000022", borderBottom: `1px solid ${C.border}` }}>
        <div className="p-3 border-r" style={{ borderColor: C.border }}>
          <MicroLabel color={C.lo}>Weeks</MicroLabel>
        </div>
        <div className="grid grid-cols-7">
          {w.dayHeaders.map((d) => (
            <div key={d} className="p-3 text-center">
              <MicroLabel color={C.lo}>{d}</MicroLabel>
            </div>
          ))}
        </div>
        <div className="p-3 border-l text-right" style={{ borderColor: C.border }}>
          <MicroLabel color={C.lo}>Total</MicroLabel>
        </div>
      </div>

      <WeekRow weekLabel="01" weekTotalKm={sum(w.week1)} cells={w.week1} />
      <WeekRow weekLabel="02" weekTotalKm={sum(w.week2)} cells={w.week2} />
      <WeekRow weekLabel="03" weekTotalKm={sum(w.week3)} cells={w.week3} isCurrentWeek />
      <WeekRow weekLabel="04" weekTotalKm={sum(w.week4)} cells={w.week4} />

      {/* Race 표기 */}
      <div className="p-4 flex items-center justify-between" style={{ background: "#00000022" }}>
        <div className="flex items-center gap-3">
          <span
            className="inline-block w-2 h-2"
            style={{ background: C.primary }}
          />
          <MicroLabel color={C.primary}>Race target</MicroLabel>
          <span style={{ fontFamily: '"Pretendard"', fontSize: 13, color: C.hi }}>
            {plan.plan.targetDistance} · {plan.plan.targetDate}
          </span>
        </div>
        <span style={{ fontFamily: '"JetBrains Mono"', fontSize: 11, color: C.lo }}>
          taper: Wk4 pre-race window
        </span>
      </div>
    </div>
  );
}

// ─── 섹션 03: REGENERATE ────────────────────────────────────────────────────

function GenerateForm({ hasActivePlan }) {
  const [freq, setFreq] = useState(4);
  const [distance, setDistance] = useState("");
  const [date, setDate] = useState("");

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 p-8"
      style={{ border: `1px solid ${C.border}`, background: C.panel }}
    >
      <div className="space-y-6">
        {/* Frequency */}
        <div>
          <MicroLabel color={C.mid} className="mb-3">Weekly frequency</MicroLabel>
          <div className="flex gap-2 mt-3">
            {[3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setFreq(n)}
                className="flex-1 py-4 transition-colors"
                style={{
                  fontFamily: '"Big Shoulders Display"',
                  fontSize: 32,
                  fontWeight: 800,
                  border: `1px solid ${freq === n ? C.primary : C.border}`,
                  background: freq === n ? `${C.primary}11` : "transparent",
                  color: freq === n ? C.primary : C.mid,
                  cursor: "pointer",
                }}
              >
                {n}
                <span style={{ fontSize: 10, fontFamily: '"Pretendard"', fontWeight: 500, display: "block", color: C.lo, marginTop: 4 }}>
                  runs/wk
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Target */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <MicroLabel color={C.mid} className="mb-3">Target distance</MicroLabel>
            <div className="flex gap-2 mt-3">
              {["", "5K", "10K", "HM", "FM"].map((d, idx) => (
                <button
                  key={idx}
                  onClick={() => setDistance(d)}
                  className="flex-1 py-2 transition-colors"
                  style={{
                    fontFamily: '"JetBrains Mono"',
                    fontSize: 12,
                    fontWeight: 600,
                    border: `1px solid ${distance === d ? C.primary : C.border}`,
                    background: distance === d ? `${C.primary}11` : "transparent",
                    color: distance === d ? C.primary : C.mid,
                    cursor: "pointer",
                  }}
                >
                  {d || "—"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <MicroLabel color={C.mid} className="mb-3">Race date {distance ? "" : "(distance 선택 후)"}</MicroLabel>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={!distance}
              className="w-full mt-3 px-3 py-2"
              style={{
                background: "transparent",
                border: `1px solid ${C.border}`,
                color: C.hi,
                fontFamily: '"JetBrains Mono"',
                fontSize: 13,
                opacity: distance ? 1 : 0.4,
              }}
            />
            <div style={{ fontSize: 10, color: C.lo, marginTop: 6, fontFamily: '"Pretendard"' }}>
              Wk4 창 내여야 taper 적용 (오늘 +21~28일)
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col justify-end gap-3">
        {hasActivePlan && (
          <div
            className="p-3"
            style={{
              border: `1px solid ${C.primary}44`,
              background: `${C.primary}0A`,
              fontFamily: '"Pretendard"',
              fontSize: 11,
              color: C.mid,
              lineHeight: 1.4,
              maxWidth: 260,
            }}
          >
            <MicroLabel color={C.primary}>Warning</MicroLabel>
            <div className="mt-1">
              기존 active plan 이 archived 로 이동합니다. 되돌릴 수 없음.
            </div>
          </div>
        )}
        <button
          className="px-10 py-4 transition-colors"
          style={{
            background: C.primary,
            color: C.hi,
            fontFamily: '"Big Shoulders Display"',
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
            border: "none",
            cursor: "pointer",
          }}
        >
          Generate plan →
        </button>
      </div>
    </div>
  );
}

// ─── 섹션 04: ARCHIVE ───────────────────────────────────────────────────────

function ArchivedList({ items }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, background: C.panel }}>
      {items.map((p, idx) => (
        <div
          key={p.planId}
          className="grid grid-cols-[80px_1fr_100px_120px] items-center p-5 cursor-pointer transition-colors hover:bg-white/[0.02]"
          style={{
            borderBottom: idx < items.length - 1 ? `1px solid ${C.border}` : "none",
          }}
        >
          <div
            style={{
              fontFamily: '"Big Shoulders Display"',
              fontSize: 32,
              fontWeight: 700,
              color: C.lo,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {String(items.length - idx).padStart(2, "0")}
          </div>
          <div>
            <div style={{ fontFamily: '"JetBrains Mono"', fontSize: 13, color: C.hi, fontVariantNumeric: "tabular-nums" }}>
              {p.startDate} — {p.endDate}
            </div>
            <div className="mt-1 flex items-center gap-3">
              <MicroLabel color={C.lo}>
                {p.weeklyFrequency}x/wk
              </MicroLabel>
              {p.targetDistance && (
                <MicroLabel color={C.primary}>
                  target · {p.targetDistance}
                </MicroLabel>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end">
            <div
              style={{
                fontFamily: '"Big Shoulders Display"',
                fontSize: 24,
                fontWeight: 700,
                color: p.completionPct >= 80 ? C.completed : p.completionPct >= 50 ? C.hi : C.missed,
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {p.completionPct}
            </div>
            <MicroLabel color={C.lo}>%</MicroLabel>
          </div>
          <div className="text-right">
            <span
              style={{
                fontFamily: '"Instrument Serif"',
                fontStyle: "italic",
                fontSize: 12,
                color: C.mid,
              }}
            >
              view details →
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── 페이지 조립 ────────────────────────────────────────────────────────────

export default function TrainingPlanPrototype() {
  return (
    <>
      {/* 폰트 로드 (실제 구현 시 next/font 로 교체) */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800;900&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
      <link
        href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        rel="stylesheet"
      />

      <div
        className="min-h-screen"
        style={{
          background: C.bg,
          color: C.hi,
          fontFamily: '"Pretendard", ui-sans-serif',
          backgroundImage:
            'radial-gradient(circle at 15% 0%, #FF6B0006 0%, transparent 50%), radial-gradient(circle at 85% 100%, #5A9CE005 0%, transparent 50%)',
        }}
      >
        {/* Header */}
        <header
          className="border-b sticky top-0 z-10 backdrop-blur"
          style={{ borderColor: C.border, background: `${C.bg}dd` }}
        >
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-baseline gap-3">
              <span
                style={{
                  fontFamily: '"Big Shoulders Display"',
                  fontWeight: 900,
                  fontSize: 22,
                  color: C.primary,
                  letterSpacing: "-0.01em",
                }}
              >
                myFITNESS
              </span>
              <span style={{ fontFamily: '"Instrument Serif"', fontStyle: "italic", fontSize: 14, color: C.mid }}>
                — training plan
              </span>
            </div>
            <nav className="flex gap-6" style={{ fontFamily: '"Pretendard"', fontSize: 12, color: C.mid, fontWeight: 500 }}>
              <a href="#" style={{ color: C.mid }}>대시보드</a>
              <a href="#" style={{ color: C.mid }}>활동</a>
              <a href="#" style={{ color: C.primary, borderBottom: `1px solid ${C.primary}` }}>플랜</a>
              <a href="#" style={{ color: C.mid }}>리포트</a>
              <a href="#" style={{ color: C.mid }}>설정</a>
            </nav>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-6 py-12 space-y-20">
          {/* SECTION 01: TODAY */}
          <section>
            <SectionHeader
              number="01"
              kicker="Today's directive"
              title="Coach's Call"
              meta="M6-4 · recommend_today_workout"
            />
            <TodayWorkoutCard today={MOCK_TODAY} />
          </section>

          {/* SECTION 02: THIS BLOCK */}
          <section>
            <SectionHeader
              number="02"
              kicker="Current block"
              title="4-Week Ledger"
              meta={`${MOCK_PLAN.plan.startDate} → ${MOCK_PLAN.plan.endDate}`}
            />
            <ProgressStrip progress={MOCK_PLAN.progress} />
            <PlanCalendar plan={MOCK_PLAN} />
          </section>

          {/* SECTION 03: REGENERATE */}
          <section>
            <SectionHeader
              number="03"
              kicker="New chapter"
              title="Regenerate"
              meta="POST /api/training-plan/generate"
            />
            <GenerateForm hasActivePlan={true} />
          </section>

          {/* SECTION 04: ARCHIVE */}
          <section>
            <SectionHeader
              number="04"
              kicker="Past cycles"
              title="Archive"
              meta={`${MOCK_ARCHIVED.length} plans`}
            />
            <ArchivedList items={MOCK_ARCHIVED} />
          </section>

          {/* Footer */}
          <footer className="pt-8 pb-6 border-t" style={{ borderColor: C.border, fontFamily: '"Instrument Serif"', fontStyle: "italic", fontSize: 12, color: C.lo }}>
            — end of ledger. 다음 블록은 활동 데이터가 갱신되면 자동으로 반영됩니다.
          </footer>
        </main>
      </div>
    </>
  );
}
