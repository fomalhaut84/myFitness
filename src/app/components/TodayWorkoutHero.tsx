import Link from "next/link";
import { C, ZONE_COLOR, TYPE_LABEL_KO, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "@/app/training-plan/theme";
import { bigShoulders, jbMono } from "@/app/training-plan/fonts";
import type { RecommendPayload } from "@/app/training-plan/types";

interface Props {
  today: RecommendPayload;
}

/**
 * 대시보드 상단 hero 카드. Coach's Ledger 톤으로 "오늘의 지시" 성격 강조.
 * 프로필 페이지의 TodayWorkoutCard 대비 컴팩트 (단일 행, factors 미니멀).
 */
export default function TodayWorkoutHero({ today }: Props) {
  const { base, recommendation, factors, rationale } = today;
  const isRest = recommendation.type === "rest";
  const zone = recommendation.zone;
  const zColor = zone ? ZONE_COLOR[zone] : C.hi;

  const readiness = factors.readiness;
  const injury = factors.injury;

  return (
    <div
      className={`${bigShoulders.variable} ${jbMono.variable} rounded-sm mb-6`}
      style={{
        border: `1px solid ${C.border}`,
        background: `linear-gradient(180deg, ${C.panelHi} 0%, ${C.panel} 100%)`,
      }}
    >
      <div
        className="p-5 md:p-8 relative overflow-hidden"
        style={{
          background: `radial-gradient(ellipse at top left, ${C.primary}0A 0%, transparent 60%)`,
        }}
      >
        {/* 상단: 오늘 라벨 + 조정 배지 + 자세히 링크 */}
        <div className="flex items-center justify-between mb-5 md:mb-6 gap-3">
          <div className="flex items-center gap-3">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: C.primary }}
            />
            <span
              style={{
                fontFamily: FONT_BODY,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: C.primary,
              }}
            >
              오늘 · {today.date}
            </span>
            {recommendation.adjusted && (
              <span
                style={{
                  fontFamily: FONT_BODY,
                  fontSize: 11,
                  fontWeight: 500,
                  color: C.mid,
                }}
              >
                · 계획에서 조정됨
              </span>
            )}
          </div>
          <Link
            href="/training-plan"
            className="transition-colors hover:opacity-80"
            style={{
              fontFamily: FONT_BODY,
              fontSize: 12,
              fontWeight: 500,
              color: C.mid,
            }}
          >
            자세히 →
          </Link>
        </div>

        {/* 본체: 좌 hero + 우 factors */}
        <div className="grid grid-cols-1 md:grid-cols-[1.6fr_1fr] gap-6 md:gap-10 items-end">
          {/* 좌: 타입 + 거리/pace/zone */}
          <div>
            <div className="flex items-end gap-3 md:gap-4 flex-wrap mb-3">
              <span
                className="text-[48px] md:text-[72px]"
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
                  className="mb-1.5 px-2 py-0.5"
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 11,
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

            {!isRest && recommendation.distanceKm !== undefined && recommendation.paceRange && (
              <div
                className="flex items-baseline gap-4 md:gap-5 flex-wrap"
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 15,
                  color: C.mid,
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 500,
                }}
              >
                <span>
                  <span style={{ color: C.hi, fontWeight: 700 }}>
                    {recommendation.distanceKm}
                  </span>
                  <span style={{ marginLeft: 4, fontSize: 12 }}>km</span>
                </span>
                <span>
                  <span style={{ color: zColor, fontWeight: 700 }}>
                    {recommendation.paceRange.min}–{recommendation.paceRange.max}
                  </span>
                  <span style={{ marginLeft: 4, fontSize: 12 }}>/km</span>
                </span>
              </div>
            )}

            {isRest && (
              <p
                style={{
                  fontFamily: FONT_BODY,
                  fontSize: 14,
                  color: C.mid,
                  fontWeight: 500,
                }}
              >
                오늘은 회복일입니다.
              </p>
            )}

            {/* Rationale — 1~2 줄 */}
            <p
              className="mt-4 md:mt-5"
              style={{
                fontFamily: FONT_BODY,
                fontSize: 13,
                lineHeight: 1.6,
                color: C.hi,
                fontWeight: 500,
              }}
            >
              {rationale}
            </p>

            {/* 원 계획 (조정된 경우) */}
            {recommendation.adjusted && base.type !== "rest" && (
              <div
                className="mt-3 flex items-baseline gap-2 flex-wrap"
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  color: C.mid,
                }}
              >
                <span style={{ color: C.lo }}>원 계획</span>
                <span
                  style={{
                    textDecoration: "line-through",
                    textDecorationColor: C.missed,
                  }}
                >
                  {TYPE_LABEL_KO[base.type]}
                  {base.distanceKm !== undefined ? ` · ${base.distanceKm} km` : ""}
                  {base.pace ? ` · ${base.pace}/km` : ""}
                </span>
              </div>
            )}
          </div>

          {/* 우: readiness + injury 인디케이터 */}
          <div className="flex md:flex-col gap-4 md:gap-3 justify-between md:justify-start md:items-end">
            <FactorPill
              label="Readiness"
              score={readiness.score}
              statusLabel={readiness.label}
            />
            <FactorPill
              label="Injury Risk"
              score={injury.score}
              statusLabel={injury.label}
              higherIsWorse
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function FactorPill({
  label,
  score,
  statusLabel,
  higherIsWorse = false,
}: {
  label: string;
  score: number | null;
  statusLabel: string | null;
  higherIsWorse?: boolean;
}) {
  if (score === null || statusLabel === null) {
    return (
      <div className="flex flex-col md:items-end gap-1">
        <span
          style={{
            fontFamily: FONT_BODY,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: C.lo,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: FONT_BODY,
            fontSize: 12,
            color: C.lo,
            fontWeight: 500,
          }}
        >
          데이터 없음
        </span>
      </div>
    );
  }
  const isBad = higherIsWorse ? score >= 50 : score < 50;
  const color = isBad ? C.missed : C.completed;
  return (
    <div className="flex flex-col md:items-end gap-1.5">
      <span
        style={{
          fontFamily: FONT_BODY,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: C.lo,
        }}
      >
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        <span
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 24,
            fontWeight: 700,
            color,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {score}
        </span>
        <span
          style={{
            fontFamily: FONT_BODY,
            fontSize: 11,
            fontWeight: 600,
            color,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {statusLabel}
        </span>
      </div>
    </div>
  );
}
