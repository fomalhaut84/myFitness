"use client";

import { C, ZONE_COLOR, TYPE_LABEL_KO, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../theme";
import type { RecommendPayload } from "../types";
import { DataUnit, MicroLabel } from "./atoms";

interface Props {
  today: RecommendPayload;
}

function FactorRow({
  label,
  score,
  statusLabel,
  higherIsWorse = false,
}: {
  label: string;
  score: number;
  statusLabel: string;
  higherIsWorse?: boolean;
}) {
  const pct = Math.round((score / 100) * 100);
  const isBad = higherIsWorse ? score >= 50 : score < 50;
  const barColor = isBad ? C.missed : C.completed;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-baseline gap-3">
          <MicroLabel color={C.mid}>{label}</MicroLabel>
          <span
            style={{
              fontFamily: FONT_BODY,
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
            fontFamily: FONT_DISPLAY,
            fontSize: 32,
            fontWeight: 700,
            color: barColor,
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
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
    </div>
  );
}

export default function TodayWorkoutCard({ today }: Props) {
  const { base, recommendation, factors, rationale } = today;
  const isRest = recommendation.type === "rest";
  const zone = recommendation.zone;
  const zColor = zone ? ZONE_COLOR[zone] : C.hi;

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-0 rounded-sm"
      style={{
        border: `1px solid ${C.border}`,
        background: `linear-gradient(180deg, ${C.panelHi} 0%, ${C.panel} 100%)`,
      }}
    >
      {/* Left: Hero */}
      <div
        className="p-6 md:p-14 lg:p-16 relative overflow-hidden lg:border-r"
        style={{
          borderColor: C.border,
          background: `radial-gradient(ellipse at top left, ${C.primary}0A 0%, transparent 60%)`,
        }}
      >
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
                fontFamily: FONT_BODY,
                fontSize: 12,
                fontWeight: 500,
                color: C.mid,
              }}
            >
              · 계획에서 조정됨
            </span>
          )}
        </div>

        <div className="mb-10">
          <div
            style={{
              fontFamily: FONT_BODY,
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
                fontFamily: FONT_DISPLAY,
                fontWeight: 800,
                lineHeight: 0.85,
                color: C.hi,
                letterSpacing: "-0.03em",
                textTransform: "uppercase",
              }}
            >
              {isRest ? "REST" : TYPE_LABEL_KO[recommendation.type]}
            </span>
            {zone && (
              <span
                className="mb-3 px-2.5 py-1"
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 12,
                  fontWeight: 600,
                  color: zColor,
                  border: `1px solid ${zColor}44`,
                  background: `${zColor}11`,
                  letterSpacing: "0.05em",
                }}
              >
                {zone}
              </span>
            )}
          </div>
        </div>

        {!isRest && recommendation.distanceKm !== undefined && recommendation.paceRange && (
          <div
            className="grid grid-cols-2 md:grid-cols-3 gap-6 md:gap-8 pt-6 md:pt-8 border-t"
            style={{ borderColor: C.border }}
          >
            <DataUnit label="Distance" value={recommendation.distanceKm} unit="km" size="lg" />
            <DataUnit label="Zone" value={zone ?? "-"} size="lg" color={zColor} />
            <div className="col-span-2 md:col-span-1">
              <DataUnit
                label="Pace range"
                value={`${recommendation.paceRange.min}–${recommendation.paceRange.max}`}
                unit="/km"
                size="md"
                color={zColor}
              />
            </div>
          </div>
        )}

        {/* 인터벌 세부 (reps × 400m 등) — interval workout 실제 수행 정보. */}
        {!isRest && recommendation.intervalDesc && (
          <div
            className="mt-6 md:mt-8 p-4 md:p-5"
            style={{
              border: `1px dashed ${zColor}66`,
              background: `${zColor}0A`,
            }}
          >
            <MicroLabel color={zColor}>인터벌 세부</MicroLabel>
            <div
              className="mt-2"
              style={{
                fontFamily: FONT_MONO,
                fontSize: 15,
                color: C.hi,
                fontWeight: 600,
                letterSpacing: "0.02em",
              }}
            >
              {recommendation.intervalDesc}
            </div>
          </div>
        )}

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
              fontFamily: FONT_BODY,
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

        {recommendation.adjusted && !isRest && base.distanceKm !== undefined && (
          <div
            className="mt-8 flex items-baseline gap-4 flex-wrap"
            style={{ color: C.mid, fontFamily: FONT_BODY, fontSize: 14 }}
          >
            <MicroLabel color={C.mid}>원 계획</MicroLabel>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 13,
                textDecoration: "line-through",
                textDecorationColor: C.missed,
                color: C.mid,
              }}
            >
              {TYPE_LABEL_KO[base.type]}
              {base.distanceKm !== undefined ? ` · ${base.distanceKm} km` : ""}
              {base.pace ? ` · ${base.pace}/km` : ""}
              {base.zone ? ` · ${base.zone}` : ""}
              {base.intervalDesc ? ` · ${base.intervalDesc}` : ""}
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
              fontFamily: FONT_BODY,
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

        {factors.readiness.score !== null && factors.readiness.label !== null ? (
          <FactorRow
            label="Readiness"
            score={factors.readiness.score}
            statusLabel={factors.readiness.label}
          />
        ) : (
          <div style={{ color: C.lo, fontFamily: FONT_BODY, fontSize: 13 }}>
            Readiness · 데이터 없음
          </div>
        )}

        {factors.injury.score !== null && factors.injury.label !== null ? (
          <FactorRow
            label="Injury Risk"
            score={factors.injury.score}
            statusLabel={factors.injury.label}
            higherIsWorse
          />
        ) : (
          <div style={{ color: C.lo, fontFamily: FONT_BODY, fontSize: 13 }}>
            Injury Risk · 데이터 없음
          </div>
        )}

        <div
          className="mt-6 p-7"
          style={{ border: `1px solid ${C.border}`, background: C.panel }}
        >
          <MicroLabel color={C.mid}>플랜 컨텍스트</MicroLabel>
          <div
            className="mt-6 space-y-3.5"
            style={{ fontFamily: FONT_MONO, fontSize: 13, color: C.mid }}
          >
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
