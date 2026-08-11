// #299 (M14 Phase 2 #3): /nutrition 페이지 — 매크로 · 근손실 위험.
// server component. 데이터 fetch 후 client 컴포넌트들에 props 로 전달.

import prisma from "@/lib/prisma";
import { todayKSTString } from "@/lib/garmin/utils";
import { aggregateRecentMacros, averageMacros } from "@/lib/nutrition/daily-macros";
import { assessMuscleLossRisk } from "@/lib/fitness/muscle-loss-risk";
import MacroDonut from "@/components/nutrition/MacroDonut";
import ProteinTrend from "@/components/nutrition/ProteinTrend";
import MuscleLossBanner from "@/components/nutrition/MuscleLossBanner";
import BackfillNotice from "@/components/nutrition/BackfillNotice";
import NutritionFoodList, {
  type NutritionFoodItem,
} from "@/components/nutrition/NutritionFoodList";

export const dynamic = "force-dynamic";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstDayRange(): { start: Date; end: Date } {
  const ymd = todayKSTString();
  const [y, m, d] = ymd.split("-").map(Number);
  const kstMidnightUTC = Date.UTC(y, m - 1, d) - KST_OFFSET_MS;
  return {
    start: new Date(kstMidnightUTC),
    end: new Date(kstMidnightUTC + 24 * 60 * 60 * 1000),
  };
}

export default async function NutritionPage() {
  const now = new Date();
  const { start: todayStart, end: todayEnd } = kstDayRange();
  const sevenDaysAgo = new Date(todayStart);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  // 병렬 fetch
  const [todayLogs, macros7d, latestWeight, latestBalances, activities7d, profile] =
    await Promise.all([
      prisma.foodLog.findMany({
        where: { date: { gte: todayStart, lt: todayEnd } },
        orderBy: { date: "asc" },
        select: {
          id: true,
          date: true,
          mealType: true,
          description: true,
          estimatedKcal: true,
          proteinG: true,
          carbsG: true,
          fatG: true,
        },
      }),
      aggregateRecentMacros(now, 7),
      prisma.bodyComposition.findFirst({
        orderBy: { date: "desc" },
        select: { weight: true },
      }),
      prisma.dailySummary.findMany({
        where: { date: { gte: sevenDaysAgo } },
        select: { calorieBalance: true },
      }),
      prisma.activity.findMany({
        where: { startTime: { gte: sevenDaysAgo } },
        select: { duration: true, intensityLabel: true },
      }),
      prisma.userProfile.findFirst({
        select: { proteinTargetPerKg: true },
      }),
    ]);

  const macroAvg = averageMacros(macros7d);
  const bodyWeightKg = latestWeight?.weight ?? null;
  const targetPerKg = profile?.proteinTargetPerKg ?? 1.6;

  // muscle-loss input
  const validBalances = latestBalances.filter(
    (b): b is { calorieBalance: number } => b.calorieBalance !== null,
  );
  const avgDailyBalance =
    validBalances.length > 0
      ? validBalances.reduce((s, b) => s + b.calorieBalance, 0) / validBalances.length
      : 0;
  const proteinPerKg =
    macroAvg.avgProteinG !== null && bodyWeightKg
      ? macroAvg.avgProteinG / bodyWeightKg
      : null;
  const highIntensityMinutes = activities7d
    .filter((a) =>
      a.intensityLabel === "threshold" ||
      a.intensityLabel === "interval" ||
      a.intensityLabel === "max",
    )
    .reduce((s, a) => s + Math.round(a.duration / 60), 0);

  const verdict = assessMuscleLossRisk({
    weeklyCalorieDeficit: -avgDailyBalance,
    avgProteinPerKg: proteinPerKg,
    weeklyHighIntensityMin: highIntensityMinutes,
    proteinTargetPerKg: targetPerKg,
  });

  // 오늘 매크로 (도넛 today view 용)
  const todayMacros = todayLogs.reduce<{
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
  }>(
    (acc, r) => ({
      proteinG:
        acc.proteinG === null ? null : r.proteinG === null ? null : acc.proteinG + r.proteinG,
      carbsG:
        acc.carbsG === null ? null : r.carbsG === null ? null : acc.carbsG + r.carbsG,
      fatG: acc.fatG === null ? null : r.fatG === null ? null : acc.fatG + r.fatG,
    }),
    { proteinG: 0, carbsG: 0, fatG: 0 },
  );

  const weeklyMacros = {
    proteinG: macroAvg.avgProteinG,
    carbsG: macroAvg.avgCarbsG,
    fatG: macroAvg.avgFatG,
  };

  const trendPoints = macros7d.map((d) => ({ date: d.date, proteinG: d.proteinG }));

  const foodItems: NutritionFoodItem[] = todayLogs.map((l) => ({
    id: l.id,
    timeIso: l.date.toISOString(),
    mealType: l.mealType,
    description: l.description,
    kcal: l.estimatedKcal,
    proteinG: l.proteinG,
    carbsG: l.carbsG,
    fatG: l.fatG,
  }));

  const missingToday = foodItems.filter(
    (i) => i.kcal == null || i.proteinG == null || i.carbsG == null || i.fatG == null,
  ).length;

  const periodLabel = `${macros7d[0]?.date.slice(5)} → ${macros7d[macros7d.length - 1]?.date.slice(5)}`;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-md md:max-w-3xl lg:max-w-6xl px-5 py-6">
        {/* Header */}
        <div className="pb-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] tracking-[0.18em] text-dim uppercase font-[family-name:var(--font-geist-mono)]">M14 · 매크로</div>
            <h1 className="text-[26px] font-semibold tracking-tight mt-0.5">Nutrition</h1>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-dim uppercase tracking-widest font-[family-name:var(--font-geist-mono)]">최근 7일</div>
            <div className="text-[13px] font-[family-name:var(--font-geist-mono)] text-sub">{periodLabel}</div>
          </div>
        </div>
        {/* Warning + Banner */}
        {missingToday > 0 && (
          <div className="mb-3">
            <BackfillNotice pendingCount={missingToday} />
          </div>
        )}
        <div className="mb-5">
          <MuscleLossBanner verdict={verdict} />
        </div>
        {/* Charts row (md 이상 2col) + Food list */}
        <div className="lg:grid lg:grid-cols-12 lg:gap-4">
          <div className="lg:col-span-8">
            <div className="grid gap-4 md:grid-cols-12 mb-4 lg:mb-0">
              <div className="md:col-span-5 lg:col-span-6">
                <MacroDonut
                  weekly={weeklyMacros}
                  today={todayMacros}
                  bodyWeightKg={bodyWeightKg}
                />
              </div>
              <div className="md:col-span-7 lg:col-span-6">
                <ProteinTrend
                  data={trendPoints}
                  targetPerKg={targetPerKg}
                  bodyWeightKg={bodyWeightKg}
                />
              </div>
            </div>
          </div>
          <div className="lg:col-span-4">
            <NutritionFoodList items={foodItems} />
          </div>
        </div>
      </div>
    </div>
  );
}
