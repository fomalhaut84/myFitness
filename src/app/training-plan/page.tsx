import { todayKSTString } from "@/lib/garmin/utils";
import { getActiveTrainingPlan } from "@/mcp/tools/training-plan";
import { recommendTodayWorkout } from "@/mcp/tools/recommend-today-workout";
import { fetchArchivedHistory } from "@/lib/training/plan-history";
import TodayWorkoutCard from "./components/TodayWorkoutCard";
import PlanCalendar from "./components/PlanCalendar";
import GeneratePlanForm from "./components/GeneratePlanForm";
import ArchivedList from "./components/ArchivedList";
import { SectionHeader } from "./components/atoms";
import { C, FONT_BODY } from "./theme";
import type { ActivePlanPayload, RecommendPayload } from "./types";

// SSR 마다 최신 상태 (mutating POST 후 router.refresh 대응).
export const dynamic = "force-dynamic";

export default async function TrainingPlanPage() {
  const todayStr = todayKSTString();

  const [activeResult, recommendResult, history] = await Promise.all([
    getActiveTrainingPlan(),
    recommendTodayWorkout(),
    fetchArchivedHistory(),
  ]);

  const active = JSON.parse(activeResult.content[0]?.text ?? "{}") as ActivePlanPayload;
  const recommend = JSON.parse(recommendResult.content[0]?.text ?? "{}") as RecommendPayload;
  // undefined/null 모두 "없음" 으로 취급 (Section 02 truthy 체크와 일관).
  const hasActivePlan = Boolean(active.plan);

  return (
    <main className="max-w-6xl mx-auto px-4 md:px-6 py-12 md:py-20 space-y-24 md:space-y-32">
      {/* 브랜딩 */}
      <div className="flex items-baseline gap-3">
        <span
          style={{
            fontFamily: '"Big Shoulders Display", ui-sans-serif',
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
          · 트레이닝 플랜
        </span>
      </div>

      {/* SECTION 01 */}
      <section>
        <SectionHeader
          number="01"
          kicker="Today's directive"
          title="Coach's Call"
          meta={`M6-4 · ${todayStr}`}
        />
        <TodayWorkoutCard today={recommend} />
      </section>

      {/* SECTION 02 */}
      <section>
        <SectionHeader
          number="02"
          kicker="Current block"
          title="4-Week Ledger"
          meta={
            active.plan
              ? `${active.plan.startDate} → ${active.plan.endDate}`
              : "no active plan"
          }
        />
        {active.plan ? (
          <PlanCalendar data={active} todayStr={todayStr} />
        ) : (
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
            active plan 이 없습니다. 아래 03 섹션에서 새 플랜을 생성해주세요.
          </div>
        )}
      </section>

      {/* SECTION 03 */}
      <section>
        <SectionHeader
          number="03"
          kicker="New chapter"
          title="Regenerate"
          meta="POST /api/training-plan/generate"
        />
        <GeneratePlanForm hasActivePlan={hasActivePlan} />
      </section>

      {/* SECTION 04 */}
      <section>
        <SectionHeader
          number="04"
          kicker="Past cycles"
          title="Archive"
          meta={`${history.length} plans`}
        />
        <ArchivedList items={history} />
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
        다음 블록은 활동 데이터가 갱신되면 자동으로 반영됩니다.
      </footer>
    </main>
  );
}
