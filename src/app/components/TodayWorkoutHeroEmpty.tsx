import Link from "next/link";
import { C, FONT_BODY, FONT_DISPLAY } from "@/app/training-plan/theme";
import { bigShoulders, jbMono } from "@/app/training-plan/fonts";

/**
 * 대시보드 hero — active plan 이 없을 때 표시. 트레이닝 플랜 CTA.
 */
export default function TodayWorkoutHeroEmpty() {
  return (
    <div
      className={`${bigShoulders.variable} ${jbMono.variable} rounded-sm mb-6`}
      style={{
        border: `1px solid ${C.border}`,
        background: C.panel,
      }}
    >
      <div className="p-6 md:p-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span
            style={{
              fontFamily: FONT_BODY,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: C.lo,
            }}
          >
            트레이닝 플랜
          </span>
          <div
            className="mt-2"
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 28,
              fontWeight: 700,
              color: C.hi,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
            }}
          >
            활성 플랜이 없습니다
          </div>
          <p
            className="mt-2"
            style={{
              fontFamily: FONT_BODY,
              fontSize: 13,
              color: C.mid,
              lineHeight: 1.6,
              fontWeight: 500,
            }}
          >
            트레이닝 블록(4~24주)을 생성하면 매일 오늘의 workout 이 여기 표시됩니다.
          </p>
        </div>
        <Link
          href="/training-plan"
          className="px-6 py-3 self-start md:self-auto transition-colors hover:opacity-90"
          style={{
            background: C.primary,
            color: "#fff",
            fontFamily: FONT_DISPLAY,
            fontSize: 15,
            fontWeight: 800,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
          }}
        >
          플랜 생성 →
        </Link>
      </div>
    </div>
  );
}
