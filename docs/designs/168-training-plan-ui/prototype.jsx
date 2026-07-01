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
  panel: "#161618",
  panelHi: "#1D1D20",
  border: "#2E2E33",
  hi: "#F5F1E8",
  mid: "#D0CBBE",       // ↑ 대비 (기존 #B4AFA5)
  lo: "#9A9489",        // ↑ 대비 (기존 #6B6560)
  muted: "#3D3B36",
  primary: "#FF7A1A",   // 살짝 밝게 (기존 #FF6B00)
  completed: "#A5CB6E", // 살짝 밝게 (기존 #8FB65E)
  missed: "#B85E4F",    // 살짝 밝게 (기존 #8B4A3F)
  z1: "#6FAFEA",
  z2: "#A5CB6E",
  z34: "#F5B324",
  z5: "#FF7A1A",
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

/** UPPERCASE 트래킹된 마이크로 라벨. 가독성 위해 사이즈/트래킹 완화. */
function MicroLabel({ children, color = C.lo, className = "" }) {
  return (
    <span
      className={`inline-block ${className}`}
      style={{
        fontFamily: "Pretendard, ui-sans-serif",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color,
      }}
    >
      {children}
    </span>
  );
}

/** 매거진 섹션 번호 + 라벨. 모바일에선 meta 하단으로 wrap. */
function SectionHeader({ number, kicker, title, meta }) {
  return (
    <div className="border-b border-white/5 pb-6 md:pb-8 mb-10 md:mb-14">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div className="flex items-baseline gap-4 md:gap-5">
          <span
            className="text-[48px] md:text-[64px]"
            style={{
              fontFamily: '"Big Shoulders Display", ui-sans-serif',
              fontWeight: 800,
              lineHeight: 0.9,
              color: C.primary,
              letterSpacing: "-0.02em",
            }}
          >
            {number}
          </span>
          <div className="flex flex-col gap-1">
            <span
              style={{
                fontFamily: '"Pretendard", ui-sans-serif',
                fontSize: 12,
                fontWeight: 500,
                color: C.mid,
                letterSpacing: "0.02em",
              }}
              className="md:text-[13px]"
            >
              {kicker}
            </span>
            <span
              className="text-[22px] md:text-[28px]"
              style={{
                fontFamily: '"Pretendard", ui-sans-serif',
                fontWeight: 700,
                lineHeight: 1.1,
                color: C.hi,
                letterSpacing: "-0.02em",
              }}
            >
              {title}
            </span>
          </div>
        </div>
        {meta && (
          <span
            className="text-[10px] md:text-[12px] w-full md:w-auto mt-2 md:mt-0 break-all"
            style={{
              fontFamily: '"JetBrains Mono", ui-monospace',
              color: C.lo,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {meta}
          </span>
        )}
      </div>
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
        className="p-6 md:p-14 lg:p-16 relative overflow-hidden lg:border-r"
        style={{
          borderColor: C.border,
          background: `radial-gradient(ellipse at top left, ${C.primary}0A 0%, transparent 60%)`,
        }}
      >
        {/* 좌상단 kicker */}
        <div className="flex items-center justify-between mb-8">
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
                fontFamily: '"Pretendard", ui-sans-serif',
                fontSize: 12,
                fontWeight: 500,
                color: C.mid,
              }}
            >
              · 계획에서 조정됨
            </span>
          )}
        </div>

        {/* Hero: 타입 + 거리 */}
        <div className="mb-10">
          <div
            style={{
              fontFamily: '"Pretendard", ui-sans-serif',
              fontSize: 14,
              fontWeight: 500,
              color: C.mid,
              marginBottom: 10,
            }}
          >
            추천 워크아웃
          </div>
          <div className="flex items-end gap-3 md:gap-5 mb-2 flex-wrap">
            <span
              className="text-[64px] md:text-[96px]"
              style={{
                fontFamily: '"Big Shoulders Display", ui-sans-serif',
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

        {/* Metrics row — 모바일 세로 스택. */}
        {!isRest && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6 md:gap-8 pt-6 md:pt-8 border-t" style={{ borderColor: C.border }}>
            <DataUnit label="Distance" value={recommendation.distanceKm} unit="km" size="lg" />
            <DataUnit label="Zone" value={recommendation.zone} size="lg" color={ZONE_COLOR[recommendation.zone]} />
            <div className="col-span-2 md:col-span-1">
              <DataUnit
                label="Pace range"
                value={`${recommendation.paceRange.min}–${recommendation.paceRange.max}`}
                unit="/km"
                size="md"
                color={ZONE_COLOR[recommendation.zone]}
              />
            </div>
          </div>
        )}

        {/* Rationale — 세리프 이탤릭 제거, 본문 sans 로 통일 (가독성). */}
        <div
          className="mt-8 md:mt-10 p-5 md:p-6"
          style={{
            background: "#0000001a",
            borderLeft: `3px solid ${C.primary}`,
          }}
        >
          <MicroLabel color={C.mid} className="mb-3">추천 근거</MicroLabel>
          <p
            style={{
              fontFamily: '"Pretendard", ui-sans-serif',
              fontSize: 16,
              lineHeight: 1.7,
              fontWeight: 500,
              color: C.hi,
              marginTop: 12,
            }}
          >
            {rationale}
          </p>
        </div>

        {/* Base 비교 */}
        {recommendation.adjusted && !isRest && (
          <div
            className="mt-8 flex items-baseline gap-4 flex-wrap"
            style={{ color: C.mid, fontFamily: '"Pretendard"', fontSize: 14 }}
          >
            <MicroLabel color={C.mid}>원 계획</MicroLabel>
            <span
              style={{
                fontFamily: '"JetBrains Mono"',
                fontSize: 13,
                textDecoration: "line-through",
                textDecorationColor: C.missed,
                color: C.mid,
              }}
            >
              {TYPE_LABEL_KO[base.type]} · {base.distanceKm} km · {base.pace}/km · {base.zone}
            </span>
          </div>
        )}
      </div>

      {/* Right: Factors */}
      <div
        className="p-6 md:p-14 flex flex-col gap-8 md:gap-10 border-t lg:border-t-0"
        style={{ borderColor: C.border }}
      >
        <div>
          <MicroLabel color={C.mid}>결정 팩터</MicroLabel>
          <div
            style={{
              fontFamily: '"Pretendard", ui-sans-serif',
              fontSize: 22,
              fontWeight: 700,
              color: C.hi,
              letterSpacing: "-0.01em",
              marginTop: 10,
            }}
          >
            컨디션 신호
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
          className="mt-6 p-7"
          style={{
            border: `1px solid ${C.border}`,
            background: C.panel,
          }}
        >
          <MicroLabel color={C.mid}>플랜 컨텍스트</MicroLabel>
          <div className="mt-6 space-y-3.5" style={{ fontFamily: '"JetBrains Mono"', fontSize: 13, color: C.mid }}>
            <div className="flex justify-between">
              <span>Active plan</span>
              <span style={{ color: factors.plan.hasActivePlan ? C.completed : C.missed, fontWeight: 600 }}>
                {factors.plan.hasActivePlan ? "yes" : "no"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Today workout row</span>
              <span style={{ color: factors.plan.todayWorkoutExists ? C.completed : C.lo, fontWeight: 600 }}>
                {factors.plan.todayWorkoutExists ? "yes" : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Rest planned</span>
              <span style={{ color: factors.plan.todayIsRestPlanned ? C.mid : C.lo, fontWeight: 600 }}>
                {factors.plan.todayIsRestPlanned ? "yes" : "no"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>LTHR source</span>
              <span style={{ color: C.hi, fontWeight: 600 }}>{factors.plan.lthrPaceSource}</span>
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
      <div className="flex items-baseline justify-between mb-3">
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
      <div className="h-1.5 rounded-none" style={{ background: C.muted }}>
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
    <div className="mb-10 md:mb-12">
      <div className="flex flex-col md:flex-row md:items-baseline md:justify-between gap-4 md:gap-0 mb-5 md:mb-6">
        <div className="flex items-baseline gap-4 md:gap-6">
          <div className="flex items-baseline gap-2">
            <span className="text-[40px] md:text-[48px]" style={{ fontFamily: '"Big Shoulders Display"', fontWeight: 800, color: C.hi, lineHeight: 0.85, fontVariantNumeric: "tabular-nums" }}>
              {completionPct}
            </span>
            <span style={{ fontFamily: '"Pretendard"', fontSize: 18, color: C.mid, fontWeight: 500 }}>%</span>
          </div>
          <span style={{ fontFamily: '"Pretendard"', fontSize: 14, color: C.mid, fontWeight: 500 }}>
            블록 진행률
          </span>
        </div>
        <div className="flex gap-4 md:gap-5 flex-wrap" style={{ fontFamily: '"Pretendard"', fontSize: 13, color: C.mid, fontWeight: 500 }}>
          <span><span style={{ color: C.completed, marginRight: 6 }}>■</span>{completed} 완료</span>
          <span><span style={{ color: C.missed, marginRight: 6 }}>■</span>{missed} 누락</span>
          <span><span style={{ color: C.lo, marginRight: 6 }}>■</span>{pending} 예정</span>
        </div>
      </div>
      <div className="h-2 flex" style={{ background: C.muted }}>
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
    background: isToday ? `${C.primary}12` : "transparent",
    outline: isToday ? `1.5px solid ${C.primary}` : "none",
    outlineOffset: -1,
    opacity: isRest ? 0.55 : 1,
    overflow: "hidden", // outline 안쪽으로 컨텐츠 clip (특히 모바일 좁은 셀에서 텍스트 오버플로 방지)
  };

  if (isRest && !isRaceDay) {
    return (
      <div className="p-2.5 md:p-6 relative min-h-[64px] md:min-h-[148px]" style={cellStyle}>
        <span className="text-[11px] md:text-[13px]" style={{ fontFamily: '"Pretendard"', fontWeight: 500, color: C.lo }}>
          휴식
        </span>
        {isToday && (
          <div className="absolute bottom-1.5 md:bottom-3 left-2.5 md:left-4 text-[8px] md:text-[10px]" style={{ fontFamily: '"Pretendard"', fontWeight: 700, color: C.primary, letterSpacing: "0.1em" }}>
            TODAY
          </div>
        )}
      </div>
    );
  }

  if (isRaceDay) {
    return (
      <div
        className="p-2.5 md:p-6 relative min-h-[64px] md:min-h-[148px]"
        style={{
          ...cellStyle,
          background: C.primary,
          opacity: 1,
          borderTop: `2px solid ${C.primary}`,
        }}
      >
        <div className="text-[13px] md:text-[18px] truncate" style={{ fontFamily: '"Pretendard"', fontWeight: 800, color: "#fff", letterSpacing: "-0.01em" }}>
          RACE
        </div>
        <div className="text-[9px] md:text-[12px] mt-0.5 md:mt-1 truncate" style={{ fontFamily: '"Pretendard"', color: "#ffffffcc", fontWeight: 500 }}>
          {notes}
        </div>
      </div>
    );
  }

  return (
    <div
      className="p-2.5 md:p-6 relative group cursor-default min-h-[64px] md:min-h-[148px]"
      style={cellStyle}
    >
      {/* 타입 이름 + zone 칩 (모바일 컴팩트) */}
      <div className="flex items-center justify-between mb-1.5 md:mb-3 gap-1">
        <span
          className="text-[11px] md:text-[14px] truncate"
          style={{
            fontFamily: '"Pretendard"',
            fontWeight: 700,
            color: isMissed ? C.missed : isCompleted ? C.completed : C.hi,
            letterSpacing: "-0.005em",
            textDecoration: isMissed ? "line-through" : "none",
          }}
        >
          {TYPE_LABEL_KO[type]}
        </span>
        {zone && (
          <span
            className="text-[8px] md:text-[10px] shrink-0"
            style={{
              fontFamily: '"JetBrains Mono"',
              fontWeight: 700,
              color: zColor,
              padding: "1px 4px",
              border: `1px solid ${zColor}66`,
              background: `${zColor}14`,
              lineHeight: 1.3,
              borderRadius: 2,
            }}
          >
            {zone}
          </span>
        )}
      </div>

      {/* 거리 */}
      <div className="flex items-baseline gap-1 md:gap-1.5 mb-0.5 md:mb-2">
        <span
          className="text-[20px] md:text-[32px]"
          style={{
            fontFamily: '"Big Shoulders Display"',
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
        <span className="text-[9px] md:text-[12px]" style={{ fontFamily: '"Pretendard"', color: C.mid, fontWeight: 500 }}>
          km
        </span>
      </div>

      {/* 페이스 */}
      <div
        className="text-[9px] md:text-[12px] truncate"
        style={{
          fontFamily: '"JetBrains Mono"',
          color: C.mid,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {pace}
      </div>

      {/* Matched activity — 모바일: 완료 dot 만, md 이상: 상세 */}
      {matched && (
        <>
          {/* 모바일: 우상단 완료 인디케이터 dot */}
          <span
            className="md:hidden absolute top-2 right-2 w-1.5 h-1.5 rounded-full"
            style={{ background: C.completed }}
            aria-label="완료"
          />
          {/* 데스크톱: 상세 표기 */}
          <div
            className="hidden md:flex mt-4 pt-3 items-baseline gap-2"
            style={{
              borderTop: `1px dashed ${C.completed}44`,
              fontFamily: '"JetBrains Mono"',
              fontSize: 11,
              color: C.completed,
              fontVariantNumeric: "tabular-nums",
              fontWeight: 500,
            }}
          >
            <span style={{ fontWeight: 700 }}>→</span>
            <span>{matched.distanceKm} · {matched.actualPace}</span>
          </div>
        </>
      )}

      {/* 오늘 인디케이터 */}
      {isToday && (
        <div className="absolute top-1.5 right-2 md:top-2 md:right-2 text-[8px] md:text-[10px]" style={{ fontFamily: '"Pretendard"', fontWeight: 700, color: C.primary, letterSpacing: "0.1em" }}>
          TODAY
        </div>
      )}
    </div>
  );
}

function WeekRow({ weekLabel, weekTotalKm, cells, isCurrentWeek, todayDate, weekStartOffset, planStart }) {
  return (
    <div className="grid grid-cols-[52px_1fr_58px] md:grid-cols-[96px_1fr_96px] items-stretch" style={{ borderBottom: `1px solid ${C.border}` }}>
      {/* 좌: 주 라벨 */}
      <div
        className="p-2 md:p-6 flex flex-col justify-between"
        style={{
          background: isCurrentWeek ? `${C.primary}08` : "transparent",
          borderRight: `1px solid ${C.border}`,
        }}
      >
        <div>
          <span className="hidden md:inline"><MicroLabel color={C.lo}>Week</MicroLabel></span>
          <div
            className="text-[24px] md:text-[42px]"
            style={{
              fontFamily: '"Big Shoulders Display"',
              fontWeight: 800,
              color: isCurrentWeek ? C.primary : C.hi,
              lineHeight: 0.85,
              marginTop: 4,
            }}
          >
            {weekLabel}
          </div>
        </div>
        {isCurrentWeek && (
          <span className="hidden md:block"><MicroLabel color={C.primary}>current</MicroLabel></span>
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
        className="p-2 md:p-6 flex flex-col items-end justify-center gap-0.5 md:gap-1"
        style={{ borderLeft: `1px solid ${C.border}` }}
      >
        <span className="hidden md:inline"><MicroLabel color={C.lo}>Vol</MicroLabel></span>
        <span
          className="text-[16px] md:text-[26px]"
          style={{
            fontFamily: '"Big Shoulders Display"',
            fontWeight: 700,
            color: C.hi,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
            marginTop: 2,
          }}
        >
          {weekTotalKm}
        </span>
        <span className="text-[9px] md:text-[11px]" style={{ fontFamily: '"Pretendard"', color: C.lo, fontWeight: 500 }}>km</span>
      </div>
    </div>
  );
}

function PlanCalendar({ plan }) {
  const w = plan.workouts;
  const sum = (cells) => cells.reduce((s, c) => s + (c.distanceKm || 0), 0).toFixed(1);
  return (
    <div style={{ border: `1px solid ${C.border}`, background: C.panel }}>
      {/* 그리드 전체 — 셀 최소 폭 확보 + 가로 스크롤. 컨텐츠가 셀 밖으로 넘치는 문제 방지. */}
      <div className="overflow-x-auto">
        <div className="min-w-[500px] md:min-w-[720px]">
          {/* 요일 헤더 */}
          <div className="grid grid-cols-[52px_1fr_58px] md:grid-cols-[96px_1fr_96px]" style={{ background: "#00000022", borderBottom: `1px solid ${C.border}` }}>
            <div className="p-2 md:p-5 border-r" style={{ borderColor: C.border }}>
              <span className="text-[9px] md:text-[11px]" style={{ fontFamily: '"Pretendard"', fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: C.lo }}>Weeks</span>
            </div>
            <div className="grid grid-cols-7">
              {w.dayHeaders.map((d) => (
                <div key={d} className="p-1.5 md:p-5 text-center">
                  <span className="text-[9px] md:text-[11px]" style={{ fontFamily: '"Pretendard"', fontWeight: 600, letterSpacing: "0.05em", color: C.lo }}>{d}</span>
                </div>
              ))}
            </div>
            <div className="p-2 md:p-5 border-l text-right" style={{ borderColor: C.border }}>
              <span className="text-[9px] md:text-[11px]" style={{ fontFamily: '"Pretendard"', fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: C.lo }}>Total</span>
            </div>
          </div>

          <WeekRow weekLabel="01" weekTotalKm={sum(w.week1)} cells={w.week1} />
          <WeekRow weekLabel="02" weekTotalKm={sum(w.week2)} cells={w.week2} />
          <WeekRow weekLabel="03" weekTotalKm={sum(w.week3)} cells={w.week3} isCurrentWeek />
          <WeekRow weekLabel="04" weekTotalKm={sum(w.week4)} cells={w.week4} />
        </div>
      </div>

      {/* Race 표기 — 모바일 세로 스택. */}
      <div className="p-5 md:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3" style={{ background: "#00000022" }}>
        <div className="flex items-center gap-3">
          <span
            className="inline-block w-2 h-2 shrink-0"
            style={{ background: C.primary }}
          />
          <MicroLabel color={C.primary}>Race target</MicroLabel>
          <span style={{ fontFamily: '"Pretendard"', fontSize: 13, color: C.hi, fontWeight: 500 }}>
            {plan.plan.targetDistance} · {plan.plan.targetDate}
          </span>
        </div>
        <span style={{ fontFamily: '"JetBrains Mono"', fontSize: 11, color: C.lo }}>
          taper: Wk4 pre-race window
        </span>
      </div>

      {/* 모바일 힌트: 셀 탭 시 상세, 완료는 우상단 도트 */}
      <div className="md:hidden px-5 py-3 text-center" style={{ borderTop: `1px solid ${C.border}`, background: "#00000011" }}>
        <span style={{ fontFamily: '"Pretendard"', fontSize: 10, color: C.lo, fontWeight: 500 }}>
          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 6, background: C.completed, marginRight: 6, verticalAlign: "middle" }} />
          완료 · 셀 탭 시 상세
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
      className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-8 md:gap-12 p-6 md:p-12 lg:p-14"
      style={{ border: `1px solid ${C.border}`, background: C.panel }}
    >
      <div className="space-y-8 md:space-y-10">
        {/* Frequency */}
        <div>
          <MicroLabel color={C.mid} className="mb-4">Weekly frequency</MicroLabel>
          <div className="flex gap-2 md:gap-3 mt-5">
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

        {/* Target — 모바일 세로 스택. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <MicroLabel color={C.mid} className="mb-3">Target distance</MicroLabel>
            <div className="flex gap-2 mt-4">
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
              className="w-full mt-4 px-4 py-3"
              style={{
                background: "transparent",
                border: `1px solid ${C.border}`,
                color: C.hi,
                fontFamily: '"JetBrains Mono"',
                fontSize: 13,
                opacity: distance ? 1 : 0.4,
              }}
            />
            <div style={{ fontSize: 11, color: C.lo, marginTop: 10, fontFamily: '"Pretendard"', fontWeight: 500 }}>
              Wk4 창 내여야 taper 적용 (오늘 +21~28일)
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col justify-end gap-4 w-full lg:w-auto">
        {hasActivePlan && (
          <div
            className="p-4 w-full lg:max-w-[280px]"
            style={{
              border: `1px solid ${C.primary}44`,
              background: `${C.primary}0A`,
              fontFamily: '"Pretendard"',
              fontSize: 12,
              color: C.mid,
              lineHeight: 1.6,
              fontWeight: 500,
            }}
          >
            <MicroLabel color={C.primary}>Warning</MicroLabel>
            <div className="mt-2">
              기존 active plan 이 archived 로 이동합니다. 되돌릴 수 없음.
            </div>
          </div>
        )}
        <button
          className="w-full lg:w-auto px-8 md:px-10 py-4 md:py-5 transition-colors"
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
          className="grid grid-cols-[56px_1fr_auto] md:grid-cols-[80px_1fr_100px_120px] items-center p-5 md:p-8 gap-4 md:gap-6 cursor-pointer transition-colors hover:bg-white/[0.02]"
          style={{
            borderBottom: idx < items.length - 1 ? `1px solid ${C.border}` : "none",
          }}
        >
          <div
            className="text-[24px] md:text-[32px]"
            style={{
              fontFamily: '"Big Shoulders Display"',
              fontWeight: 700,
              color: C.lo,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {String(items.length - idx).padStart(2, "0")}
          </div>
          <div className="min-w-0">
            <div className="text-[12px] md:text-[14px] truncate" style={{ fontFamily: '"JetBrains Mono"', color: C.hi, fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
              {p.startDate} — {p.endDate}
            </div>
            <div className="mt-2 flex items-center gap-3 md:gap-4 flex-wrap">
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
              className="text-[20px] md:text-[24px]"
              style={{
                fontFamily: '"Big Shoulders Display"',
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
          <div className="hidden md:block text-right">
            <span
              style={{
                fontFamily: '"Pretendard"',
                fontSize: 13,
                fontWeight: 500,
                color: C.mid,
              }}
            >
              상세 보기 →
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
          <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
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
              <span style={{ fontFamily: '"Pretendard"', fontSize: 14, color: C.mid, fontWeight: 500 }}>
                · 트레이닝 플랜
              </span>
            </div>
            <nav className="hidden md:flex gap-6" style={{ fontFamily: '"Pretendard"', fontSize: 12, color: C.mid, fontWeight: 500 }}>
              <a href="#" style={{ color: C.mid }}>대시보드</a>
              <a href="#" style={{ color: C.mid }}>활동</a>
              <a href="#" style={{ color: C.primary, borderBottom: `1px solid ${C.primary}` }}>플랜</a>
              <a href="#" style={{ color: C.mid }}>리포트</a>
              <a href="#" style={{ color: C.mid }}>설정</a>
            </nav>
            {/* 모바일 햄버거 (프로토타입은 정적) */}
            <button className="md:hidden p-2" aria-label="메뉴" style={{ color: C.mid }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path d="M3 5h14v1.5H3zM3 9.25h14v1.5H3zM3 13.5h14V15H3z" />
              </svg>
            </button>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 md:px-6 py-12 md:py-20 space-y-24 md:space-y-32">
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
          <footer className="pt-12 pb-8 border-t" style={{ borderColor: C.border, fontFamily: '"Pretendard"', fontSize: 13, color: C.lo, fontWeight: 500 }}>
            다음 블록은 활동 데이터가 갱신되면 자동으로 반영됩니다.
          </footer>
        </main>
      </div>
    </>
  );
}
