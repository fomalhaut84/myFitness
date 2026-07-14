import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchPlanDetail } from "@/lib/training/plan-detail";
import PlanCalendar from "@/app/training-plan/components/PlanCalendar";
import { SectionHeader, MicroLabel } from "@/app/training-plan/components/atoms";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "@/app/training-plan/theme";
import type {
  ActivePlanPayload,
  GoalType,
  GoalValuePayload,
} from "@/app/training-plan/types";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ planId: string }>;
}

function formatPaceShort(secPerKm: number | null): string {
  if (secPerKm === null) return "—";
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function StatItem({
  label,
  value,
  unit,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <MicroLabel color={C.lo}>{label}</MicroLabel>
      <div className="flex items-baseline gap-1.5">
        <span
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 32,
            fontWeight: 700,
            color: C.hi,
            lineHeight: 0.9,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.02em",
          }}
        >
          {value}
        </span>
        {unit && (
          <span
            style={{
              fontFamily: FONT_BODY,
              fontSize: 12,
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

export default async function ArchivedPlanDetailPage({ params }: Props) {
  const { planId } = await params;
  const detail = await fetchPlanDetail(planId);
  if (!detail) notFound();

  const { plan, workouts, progress } = detail;

  // PlanCalendar 에 맞게 어댑팅. targetDistance/targetDate 은 null→undefined 변환.
  const calendarData: ActivePlanPayload = {
    plan: {
      planId: plan.planId,
      startDate: plan.startDate,
      endDate: plan.endDate,
      weekCount: plan.weekCount,
      weeklyFrequency: plan.weeklyFrequency,
      goalType: plan.goalType as GoalType,
      goalValue: (plan.goalValue as GoalValuePayload) ?? undefined,
      targetDistance: plan.targetDistance ?? undefined,
      targetDate: plan.targetDate ?? undefined,
    },
    progress,
    workouts,
  };

  // todayStr 을 endDate 로 넘겨 "오늘" 하이라이트 없음.
  const frozenTodayStr = plan.endDate;

  return (
    <main className="max-w-6xl mx-auto px-4 md:px-6 py-12 md:py-20 space-y-16 md:space-y-20">
      {/* 브랜딩 + 돌아가기 */}
      <div className="flex flex-col gap-6">
        <Link
          href="/training-plan"
          className="inline-flex items-center gap-2 self-start transition-colors"
          style={{
            fontFamily: FONT_BODY,
            fontSize: 13,
            color: C.mid,
            fontWeight: 500,
          }}
        >
          <span>←</span>
          <span>트레이닝 플랜</span>
        </Link>
        <div className="flex items-baseline gap-3">
          <span
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 900,
              fontSize: 22,
              color: C.primary,
              letterSpacing: "-0.01em",
            }}
          >
            myFITNESS
          </span>
          <span
            style={{
              fontFamily: FONT_BODY,
              fontSize: 14,
              color: C.mid,
              fontWeight: 500,
            }}
          >
            · 지난 블록 상세
          </span>
        </div>
      </div>

      {/* Plan meta */}
      <section>
        <SectionHeader
          number="01"
          kicker="Block info"
          title="Plan meta"
          meta={`${plan.status} · ${plan.startDate} → ${plan.endDate}`}
        />
        <div
          className="p-6 md:p-10"
          style={{ border: `1px solid ${C.border}`, background: C.panel }}
        >
          <div className="grid grid-cols-2 md:grid-cols-5 gap-6 md:gap-8">
            <StatItem label="기간" value={plan.weekCount} unit="주" />
            <StatItem
              label="주간 빈도"
              value={plan.weeklyFrequency}
              unit="x/wk"
            />
            <StatItem
              label="Baseline"
              value={plan.baselineWeeklyKm ?? "—"}
              unit={plan.baselineWeeklyKm !== null ? "km/wk" : undefined}
            />
            <StatItem
              label="ACWR"
              value={plan.baselineAcwr?.toFixed(2) ?? "—"}
            />
            <StatItem
              label="LTHR pace"
              value={formatPaceShort(plan.lthrPaceUsed)}
              unit={plan.lthrPaceUsed !== null ? "/km" : undefined}
            />
          </div>
          <div
            className="mt-8 pt-6 flex items-center gap-3 flex-wrap"
            style={{ borderTop: `1px solid ${C.border}` }}
          >
            <MicroLabel color={C.mid}>Goal · {plan.goalType}</MicroLabel>
            {/* 상세 goal 값은 아래 PlanCalendar 배너에서 표시. */}
          </div>
        </div>
      </section>

      {/* 주별 캘린더 */}
      <section>
        <SectionHeader
          number="02"
          kicker="Workouts"
          title={`${plan.weekCount}-Week Ledger`}
          meta={
            plan.status === "archived"
              ? "frozen · matching cutoff = 후속 plan 생성 시점"
              : "current"
          }
        />
        <PlanCalendar data={calendarData} todayStr={frozenTodayStr} />
      </section>

      <footer
        className="pt-12 pb-8 border-t"
        style={{
          borderColor: C.border,
          fontFamily: FONT_BODY,
          fontSize: 13,
          color: C.lo,
          fontWeight: 500,
        }}
      >
        Plan #{plan.planId.slice(-8)} · created {plan.createdAt.slice(0, 10)}
      </footer>
    </main>
  );
}
