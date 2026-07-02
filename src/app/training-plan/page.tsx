import { todayKSTString } from "@/lib/garmin/utils";
import { getActiveTrainingPlan } from "@/mcp/tools/training-plan";
import { recommendTodayWorkout } from "@/mcp/tools/recommend-today-workout";
import prisma from "@/lib/prisma";
import { ymdKST } from "@/lib/garmin/utils";
import { formatPace } from "@/mcp/tools/running-buckets";
import TodayWorkoutCard from "./components/TodayWorkoutCard";
import PlanCalendar from "./components/PlanCalendar";
import GeneratePlanForm from "./components/GeneratePlanForm";
import ArchivedList from "./components/ArchivedList";
import { SectionHeader } from "./components/atoms";
import { C, FONT_BODY } from "./theme";
import type {
  ActivePlanPayload,
  HistoryItem,
  RecommendPayload,
} from "./types";

// SSR 마다 최신 상태 (mutating POST 후 router.refresh 대응).
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnlyToKstStart(dateOnly: Date): Date {
  return new Date(`${ymdKST(dateOnly)}T00:00:00+09:00`);
}

async function fetchHistory(): Promise<HistoryItem[]> {
  // API route 와 같은 로직을 SSR 안에서 직접 호출 (route 왕복 회피).
  const plans = await prisma.trainingPlan.findMany({
    where: { status: "archived" },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      workouts: { select: { date: true, type: true, distanceKm: true } },
    },
  });
  const items = await Promise.all(
    plans.map(async (plan) => {
      const planStart = dateOnlyToKstStart(plan.startDate);
      const planEnd = new Date(
        dateOnlyToKstStart(plan.endDate).getTime() + DAY_MS
      );
      const activities = await prisma.activity.findMany({
        where: {
          startTime: { gte: planStart, lt: planEnd },
          activityType: { contains: "running" },
          distance: { not: null },
        },
        select: { startTime: true, distance: true },
      });
      const byDate = new Map<string, number[]>();
      for (const a of activities) {
        const key = ymdKST(a.startTime);
        const distKm = (a.distance ?? 0) / 1000;
        const list = byDate.get(key);
        if (list) list.push(distKm);
        else byDate.set(key, [distKm]);
      }
      const active = plan.workouts.filter((w) => w.type !== "rest");
      let completed = 0;
      for (const w of active) {
        const dateStr = ymdKST(w.date);
        const matches = byDate.get(dateStr) ?? [];
        const threshold = (w.distanceKm ?? 0) * 0.9;
        if (matches.some((d) => d >= threshold)) completed++;
      }
      const completionPct =
        active.length > 0
          ? Math.round((completed / active.length) * 1000) / 10
          : 0;
      return {
        planId: plan.id,
        startDate: ymdKST(plan.startDate),
        endDate: ymdKST(plan.endDate),
        weeklyFrequency: plan.weeklyFrequency,
        targetDistance: plan.targetDistance ?? null,
        targetDate:
          plan.targetDate !== null ? ymdKST(plan.targetDate) : null,
        totalActive: active.length,
        completed,
        completionPct,
        createdAt: plan.createdAt.toISOString(),
      };
    })
  );
  // formatPace 는 여기서 미사용 — TS 엄격성 회피용 참조.
  void formatPace;
  return items;
}

export default async function TrainingPlanPage() {
  const todayStr = todayKSTString();

  const [activeResult, recommendResult, history] = await Promise.all([
    getActiveTrainingPlan(),
    recommendTodayWorkout(),
    fetchHistory(),
  ]);

  const active = JSON.parse(activeResult.content[0]?.text ?? "{}") as ActivePlanPayload;
  const recommend = JSON.parse(recommendResult.content[0]?.text ?? "{}") as RecommendPayload;
  const hasActivePlan = active.plan !== null;

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
