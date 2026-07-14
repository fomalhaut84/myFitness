"use client";

import { useState } from "react";
import { C, ZONE_COLOR, TYPE_LABEL_KO, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../theme";
import type { ActivePlanPayload, ActivePlanWorkout } from "../types";
import { MicroLabel } from "./atoms";
import WorkoutEditModal from "./WorkoutEditModal";

interface Props {
  data: ActivePlanPayload;
  todayStr: string; // KST YYYY-MM-DD
  editable?: boolean; // M8: true 이면 셀 클릭 시 편집 모달 (active plan 만).
}

const DAY_HEADERS_BASE = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DAY_MS = 24 * 60 * 60 * 1000;

// 0 = Mon ~ 6 = Sun. UTC 기준 자정 Date 를 받아 monday-0 dayIndex 반환.
function mondayZeroDayIndex(utcDate: Date): number {
  const sunZero = utcDate.getUTCDay();
  return (sunZero + 6) % 7;
}

// plan 시작 요일 기준으로 헤더 로테이션. 시작이 Fri 라면 [FRI SAT SUN MON TUE WED THU].
function rotatedHeaders(startDayIdx: number): string[] {
  return [
    ...DAY_HEADERS_BASE.slice(startDayIdx),
    ...DAY_HEADERS_BASE.slice(0, startDayIdx),
  ];
}

// 주별 workout 그룹핑 + 각 컬럼 채우기. 컬럼 인덱스는 plan-start 기준 오프셋 (0~6).
// M11 Phase 1 (#222): weekCount 자유 지정(4~24) 지원.
function groupByWeek(
  workouts: ActivePlanWorkout[],
  planStartYmd: string,
  weekCount: number
): ActivePlanWorkout[][] {
  const start = new Date(`${planStartYmd}T00:00:00Z`);
  const buckets: ActivePlanWorkout[][] = Array.from(
    { length: weekCount },
    () => [],
  );
  for (const w of workouts) {
    const d = new Date(`${w.date}T00:00:00Z`);
    const daysDiff = Math.round((d.getTime() - start.getTime()) / DAY_MS);
    const wi = Math.floor(daysDiff / 7);
    if (wi >= 0 && wi < weekCount) buckets[wi].push(w);
  }
  return buckets;
}

function ProgressStrip({
  progress,
}: {
  progress: NonNullable<ActivePlanPayload["progress"]>;
}) {
  const { completed, missed, pending, total, completionPct } = progress;
  const c = total > 0 ? (completed / total) * 100 : 0;
  const m = total > 0 ? (missed / total) * 100 : 0;
  return (
    <div className="mb-10 md:mb-12">
      <div className="flex flex-col md:flex-row md:items-baseline md:justify-between gap-4 md:gap-0 mb-5 md:mb-6">
        <div className="flex items-baseline gap-4 md:gap-6">
          <div className="flex items-baseline gap-2">
            <span
              className="text-[40px] md:text-[48px]"
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 800,
                color: C.hi,
                lineHeight: 0.85,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {completionPct}
            </span>
            <span
              style={{ fontFamily: FONT_BODY, fontSize: 18, color: C.mid, fontWeight: 500 }}
            >
              %
            </span>
          </div>
          <span
            style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.mid, fontWeight: 500 }}
          >
            블록 진행률
          </span>
        </div>
        <div
          className="flex gap-4 md:gap-5 flex-wrap"
          style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.mid, fontWeight: 500 }}
        >
          <span>
            <span style={{ color: C.completed, marginRight: 6 }}>■</span>
            {completed} 완료
          </span>
          <span>
            <span style={{ color: C.missed, marginRight: 6 }}>■</span>
            {missed} 누락
          </span>
          <span>
            <span style={{ color: C.lo, marginRight: 6 }}>■</span>
            {pending} 예정
          </span>
        </div>
      </div>
      <div className="h-2 flex" style={{ background: C.muted }}>
        <div
          style={{ width: `${c}%`, background: C.completed }}
          className="transition-all duration-700"
        />
        <div
          style={{ width: `${m}%`, background: C.missed }}
          className="transition-all duration-700"
        />
      </div>
    </div>
  );
}

function CalendarCell({
  cell,
  isToday,
  isRaceDay,
  onEdit,
}: {
  cell: ActivePlanWorkout | null;
  isToday: boolean;
  isRaceDay: boolean;
  onEdit?: (w: ActivePlanWorkout) => void;
}) {
  const cellStyle: React.CSSProperties = {
    borderTop: `1px solid ${isToday ? C.primary : C.border}`,
    background: isToday ? `${C.primary}12` : "transparent",
    outline: isToday ? `1.5px solid ${C.primary}` : "none",
    outlineOffset: -1,
    opacity: !cell || cell.type === "rest" ? 0.55 : 1,
    overflow: "hidden",
  };

  if (!cell || cell.type === "rest") {
    // race day: rest 로 계획됐으나 targetDate 인 경우 별도 표시.
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
          <div
            className="text-[13px] md:text-[18px] truncate"
            style={{ fontFamily: FONT_BODY, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em" }}
          >
            RACE
          </div>
        </div>
      );
    }
    return (
      <div
        className="p-2.5 md:p-6 relative min-h-[64px] md:min-h-[148px]"
        style={cellStyle}
      >
        <span
          className="text-[11px] md:text-[13px]"
          style={{ fontFamily: FONT_BODY, fontWeight: 500, color: C.lo }}
        >
          휴식
        </span>
        {isToday && (
          <div
            className="absolute bottom-1.5 md:bottom-3 left-2.5 md:left-4 text-[8px] md:text-[10px]"
            style={{
              fontFamily: FONT_BODY,
              fontWeight: 700,
              color: C.primary,
              letterSpacing: "0.1em",
            }}
          >
            TODAY
          </div>
        )}
      </div>
    );
  }

  const isMissed = cell.status === "missed";
  const isCompleted = cell.status === "completed";
  const zColor = cell.zone ? ZONE_COLOR[cell.zone] : null;

  const clickable = onEdit !== undefined;
  return (
    <div
      className={`p-2.5 md:p-6 relative group min-h-[64px] md:min-h-[148px] ${clickable ? "cursor-pointer" : "cursor-default"}`}
      style={cellStyle}
      onClick={clickable ? () => onEdit(cell) : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onEdit(cell);
              }
            }
          : undefined
      }
    >
      <div className="flex items-center justify-between mb-1.5 md:mb-3 gap-1">
        <span
          className="text-[11px] md:text-[14px] truncate"
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 700,
            color: isMissed ? C.missed : isCompleted ? C.completed : C.hi,
            letterSpacing: "-0.005em",
            textDecoration: isMissed ? "line-through" : "none",
          }}
        >
          {TYPE_LABEL_KO[cell.type]}
        </span>
        {cell.zone && zColor && (
          <span
            className="text-[8px] md:text-[10px] shrink-0"
            style={{
              fontFamily: FONT_MONO,
              fontWeight: 700,
              color: zColor,
              padding: "1px 4px",
              border: `1px solid ${zColor}66`,
              background: `${zColor}14`,
              lineHeight: 1.3,
              borderRadius: 2,
            }}
          >
            {cell.zone}
          </span>
        )}
      </div>

      {cell.distanceKm !== null && (
        <div className="flex items-baseline gap-1 md:gap-1.5 mb-0.5 md:mb-2">
          <span
            className="text-[20px] md:text-[32px]"
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 800,
              color: C.hi,
              lineHeight: 0.9,
              fontVariantNumeric: "tabular-nums",
              textDecoration: isMissed ? "line-through" : "none",
              textDecorationColor: C.missed,
            }}
          >
            {cell.distanceKm}
          </span>
          <span
            className="text-[9px] md:text-[12px]"
            style={{ fontFamily: FONT_BODY, color: C.mid, fontWeight: 500 }}
          >
            km
          </span>
        </div>
      )}

      {cell.pace && (
        <div
          className="text-[9px] md:text-[12px] truncate"
          style={{ fontFamily: FONT_MONO, color: C.mid, fontVariantNumeric: "tabular-nums" }}
        >
          {cell.pace}
        </div>
      )}

      {cell.matched && (
        <>
          {/* 모바일: 우상단 완료 dot + 하단 축약 매칭 정보 (사용자가 실제 뛴 값 확인). */}
          <span
            className="md:hidden absolute top-2 right-2 w-1.5 h-1.5 rounded-full"
            style={{ background: C.completed }}
            aria-label="완료"
          />
          <div
            className="md:hidden mt-1 truncate"
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              color: C.completed,
              fontVariantNumeric: "tabular-nums",
              fontWeight: 600,
            }}
          >
            → {cell.matched.distanceKm}
            {cell.matched.actualPace ? ` · ${cell.matched.actualPace}` : ""}
          </div>
          {/* 데스크톱: 대시라인 + 상세 정보. */}
          <div
            className="hidden md:flex mt-4 pt-3 items-baseline gap-2"
            style={{
              borderTop: `1px dashed ${C.completed}44`,
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: C.completed,
              fontVariantNumeric: "tabular-nums",
              fontWeight: 500,
            }}
          >
            <span style={{ fontWeight: 700 }}>→</span>
            <span>
              {cell.matched.distanceKm}
              {cell.matched.actualPace ? ` · ${cell.matched.actualPace}` : ""}
            </span>
          </div>
        </>
      )}

      {isToday && (
        <div
          className="absolute top-1.5 right-2 md:top-2 md:right-2 text-[8px] md:text-[10px]"
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 700,
            color: C.primary,
            letterSpacing: "0.1em",
          }}
        >
          TODAY
        </div>
      )}
    </div>
  );
}

function WeekRow({
  weekIdx,
  cells,
  isCurrentWeek,
  todayStr,
  raceDateStr,
  startDayIdx,
  onEdit,
}: {
  weekIdx: number;
  cells: ActivePlanWorkout[];
  isCurrentWeek: boolean;
  todayStr: string;
  raceDateStr: string | null;
  startDayIdx: number;
  onEdit?: (w: ActivePlanWorkout) => void;
}) {
  // dayIndex 별 workout 매칭 (0 = Mon).
  const byDayIndex = new Map<number, ActivePlanWorkout>();
  for (const w of cells) {
    const d = new Date(`${w.date}T00:00:00Z`);
    byDayIndex.set(mondayZeroDayIndex(d), w);
  }
  const totalKm = cells.reduce((s, w) => s + (w.distanceKm ?? 0), 0);
  const weekLabel = String(weekIdx + 1).padStart(2, "0");

  return (
    <div
      className="grid grid-cols-[52px_1fr_58px] md:grid-cols-[96px_1fr_96px] items-stretch"
      style={{ borderBottom: `1px solid ${C.border}` }}
    >
      <div
        className="p-2 md:p-6 flex flex-col justify-between"
        style={{
          background: isCurrentWeek ? `${C.primary}08` : "transparent",
          borderRight: `1px solid ${C.border}`,
        }}
      >
        <div>
          <span className="hidden md:inline">
            <MicroLabel color={C.lo}>Week</MicroLabel>
          </span>
          <div
            className="text-[24px] md:text-[42px]"
            style={{
              fontFamily: FONT_DISPLAY,
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
          <span className="hidden md:block">
            <MicroLabel color={C.primary}>current</MicroLabel>
          </span>
        )}
      </div>

      <div className="grid grid-cols-7">
        {[0, 1, 2, 3, 4, 5, 6].map((col) => {
          // col 0 = plan 시작 요일. rotated 매핑.
          const di = (startDayIdx + col) % 7;
          const w = byDayIndex.get(di) ?? null;
          const dateStr = w?.date ?? "";
          const isToday = dateStr === todayStr;
          const isRaceDay = raceDateStr !== null && dateStr === raceDateStr;
          return (
            <CalendarCell
              key={col}
              cell={w}
              isToday={isToday}
              isRaceDay={isRaceDay}
              onEdit={onEdit}
            />
          );
        })}
      </div>

      <div
        className="p-2 md:p-6 flex flex-col items-end justify-center gap-0.5 md:gap-1"
        style={{ borderLeft: `1px solid ${C.border}` }}
      >
        <span className="hidden md:inline">
          <MicroLabel color={C.lo}>Vol</MicroLabel>
        </span>
        <span
          className="text-[16px] md:text-[26px]"
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            color: C.hi,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
            marginTop: 2,
          }}
        >
          {Math.round(totalKm * 10) / 10}
        </span>
        <span
          className="text-[9px] md:text-[11px]"
          style={{ fontFamily: FONT_BODY, color: C.lo, fontWeight: 500 }}
        >
          km
        </span>
      </div>
    </div>
  );
}

export default function PlanCalendar({ data, todayStr, editable = false }: Props) {
  const [editWorkout, setEditWorkout] = useState<ActivePlanWorkout | null>(null);
  if (!data.plan || !data.workouts || !data.progress) {
    return null;
  }
  const buckets = groupByWeek(data.workouts, data.plan.startDate, data.plan.weekCount);
  const raceDate = data.plan.targetDate ?? null;

  // plan 시작 요일 계산 → 컬럼 헤더/셀 회전. 시작이 월요일이 아닐 때도
  // Wk1 첫 셀 = 실제 시작일이 되도록 정렬해 시간 순서 유지.
  const startDayIdx = mondayZeroDayIndex(
    new Date(`${data.plan.startDate}T00:00:00Z`)
  );
  const dayHeaders = rotatedHeaders(startDayIdx);

  // current week 판정: todayStr 이 포함된 bucket.
  const currentWeekIdx = buckets.findIndex((cells) =>
    cells.some((w) => w.date === todayStr)
  );

  return (
    <>
      <ProgressStrip progress={data.progress} />
      <div style={{ border: `1px solid ${C.border}`, background: C.panel }}>
        <div className="overflow-x-auto">
          <div className="min-w-[500px] md:min-w-[720px]">
            <div
              className="grid grid-cols-[52px_1fr_58px] md:grid-cols-[96px_1fr_96px]"
              style={{ background: "#00000022", borderBottom: `1px solid ${C.border}` }}
            >
              <div className="p-2 md:p-5 border-r" style={{ borderColor: C.border }}>
                <span
                  className="text-[9px] md:text-[11px]"
                  style={{
                    fontFamily: FONT_BODY,
                    fontWeight: 600,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: C.lo,
                  }}
                >
                  Weeks
                </span>
              </div>
              <div className="grid grid-cols-7">
                {dayHeaders.map((d, col) => (
                  <div key={col} className="p-1.5 md:p-5 text-center">
                    <span
                      className="text-[9px] md:text-[11px]"
                      style={{
                        fontFamily: FONT_BODY,
                        fontWeight: 600,
                        letterSpacing: "0.05em",
                        color: C.lo,
                      }}
                    >
                      {d}
                    </span>
                  </div>
                ))}
              </div>
              <div className="p-2 md:p-5 border-l text-right" style={{ borderColor: C.border }}>
                <span
                  className="text-[9px] md:text-[11px]"
                  style={{
                    fontFamily: FONT_BODY,
                    fontWeight: 600,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: C.lo,
                  }}
                >
                  Total
                </span>
              </div>
            </div>

            {buckets.map((cells, idx) => (
              <WeekRow
                key={idx}
                weekIdx={idx}
                cells={cells}
                isCurrentWeek={idx === currentWeekIdx}
                todayStr={todayStr}
                raceDateStr={raceDate}
                startDayIdx={startDayIdx}
                onEdit={editable ? setEditWorkout : undefined}
              />
            ))}
          </div>
        </div>

        {data.plan.targetDistance && data.plan.targetDate && (
          <div
            className="p-5 md:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
            style={{ background: "#00000022" }}
          >
            <div className="flex items-center gap-3">
              <span
                className="inline-block w-2 h-2 shrink-0"
                style={{ background: C.primary }}
              />
              <MicroLabel color={C.primary}>Race target</MicroLabel>
              <span
                style={{
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  color: C.hi,
                  fontWeight: 500,
                }}
              >
                {data.plan.targetDistance} · {data.plan.targetDate}
              </span>
            </div>
            <span
              style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.lo }}
            >
              taper: 마지막 주 pre-race window
            </span>
          </div>
        )}

        <div
          className="md:hidden px-5 py-3 text-center"
          style={{ borderTop: `1px solid ${C.border}`, background: "#00000011" }}
        >
          <span
            style={{ fontFamily: FONT_BODY, fontSize: 10, color: C.lo, fontWeight: 500 }}
          >
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: 6,
                background: C.completed,
                marginRight: 6,
                verticalAlign: "middle",
              }}
            />
            완료 · 아래 축약 = 실제 뛴 거리 · 페이스
          </span>
        </div>
      </div>

      {editWorkout && data.plan && (
        <WorkoutEditModal
          planId={data.plan.planId}
          workout={editWorkout}
          onClose={() => setEditWorkout(null)}
        />
      )}
    </>
  );
}
