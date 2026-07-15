"use client";

import Link from "next/link";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../theme";
import type { HistoryItem } from "../types";
import { MicroLabel } from "./atoms";

interface Props {
  items: HistoryItem[];
}

/** goalType 별 요약 뱃지. distance 는 targetDistance, time 은 sub-time, endurance 는 long km. */
function renderGoalBadge(p: HistoryItem): React.ReactNode {
  if (p.goalType === "distance" && p.targetDistance) {
    return (
      <MicroLabel color={C.primary}>target · {p.targetDistance}</MicroLabel>
    );
  }
  if (p.goalType === "time" && p.goalValue) {
    const g = p.goalValue as { distance?: string };
    if (typeof g.distance === "string") {
      return <MicroLabel color={C.primary}>{g.distance} · sub-time</MicroLabel>;
    }
  }
  if (p.goalType === "endurance" && p.goalValue) {
    const g = p.goalValue as { targetLongRunKm?: number };
    if (typeof g.targetLongRunKm === "number") {
      return (
        <MicroLabel color={C.primary}>long {g.targetLongRunKm}km</MicroLabel>
      );
    }
  }
  if (p.goalType === "weight_loss" && p.goalValue) {
    const g = p.goalValue as { intensityMode?: string };
    if (typeof g.intensityMode === "string") {
      return <MicroLabel color={C.primary}>intensity · {g.intensityMode}</MicroLabel>;
    }
  }
  return null;
}

export default function ArchivedList({ items }: Props) {
  if (items.length === 0) {
    return (
      <div
        className="p-10 text-center"
        style={{
          border: `1px solid ${C.border}`,
          background: C.panel,
          fontFamily: FONT_BODY,
          fontSize: 14,
          color: C.lo,
          fontWeight: 500,
        }}
      >
        아직 보관된 플랜이 없습니다.
      </div>
    );
  }
  return (
    <div style={{ border: `1px solid ${C.border}`, background: C.panel }}>
      {items.map((p, idx) => (
        <Link
          key={p.planId}
          href={`/training-plan/history/${p.planId}`}
          className="grid grid-cols-[56px_1fr_auto] md:grid-cols-[80px_1fr_100px_120px] items-center p-5 md:p-8 gap-4 md:gap-6 transition-colors hover:bg-white/[0.02]"
          style={{
            borderBottom:
              idx < items.length - 1 ? `1px solid ${C.border}` : "none",
          }}
        >
          <div
            className="text-[24px] md:text-[32px]"
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              color: C.lo,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {String(items.length - idx).padStart(2, "0")}
          </div>
          <div className="min-w-0">
            <div
              className="text-[12px] md:text-[14px] truncate"
              style={{
                fontFamily: FONT_MONO,
                color: C.hi,
                fontVariantNumeric: "tabular-nums",
                fontWeight: 500,
              }}
            >
              {p.startDate} — {p.endDate}
            </div>
            <div className="mt-2 flex items-center gap-3 md:gap-4 flex-wrap">
              <MicroLabel color={C.lo}>{p.weekCount}wk</MicroLabel>
              <MicroLabel color={C.lo}>{p.weeklyFrequency}x/wk</MicroLabel>
              <MicroLabel color={C.mid}>goal · {p.goalType}</MicroLabel>
              {renderGoalBadge(p)}
            </div>
          </div>
          <div className="flex flex-col items-end">
            <div
              className="text-[20px] md:text-[24px]"
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 700,
                color:
                  p.completionPct >= 80
                    ? C.completed
                    : p.completionPct >= 50
                    ? C.hi
                    : C.missed,
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {p.completionPct}
            </div>
            <MicroLabel color={C.lo}>%</MicroLabel>
          </div>
          <div className="hidden md:flex md:items-baseline md:justify-end md:gap-3 text-right">
            <span
              style={{
                fontFamily: FONT_BODY,
                fontSize: 13,
                fontWeight: 500,
                color: C.mid,
              }}
            >
              {p.completed}/{p.totalActive} 완료
            </span>
            <span
              style={{
                fontFamily: FONT_BODY,
                fontSize: 13,
                fontWeight: 500,
                color: C.mid,
              }}
            >
              →
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
