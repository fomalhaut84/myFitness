// #299 (M14 Phase 2 #3): /nutrition 페이지 — 매크로 · 근손실 위험.
// server component. 데이터 fetch 후 client 컴포넌트들에 props 로 전달.

import prisma from "@/lib/prisma";
import { todayKSTString } from "@/lib/garmin/utils";
import { aggregateRecentMacros, averageMacros, averageCompleteMacros } from "@/lib/nutrition/daily-macros";
import { MAX_NUTRITION_ATTEMPTS } from "@/lib/nutrition/backfill";
import { assessMuscleLossRisk } from "@/lib/fitness/muscle-loss-risk";
import { parseZoneDistribution } from "@/lib/fitness/intensity";
import MacroDonut from "@/components/nutrition/MacroDonut";
import ProteinTrend from "@/components/nutrition/ProteinTrend";
import MuscleLossBanner from "@/components/nutrition/MuscleLossBanner";
import BackfillNotice from "@/components/nutrition/BackfillNotice";
import NutritionFoodList, {
  type NutritionFoodItem,
} from "@/components/nutrition/NutritionFoodList";

export const dynamic = "force-dynamic";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
// Codex P2 (PR #300): daysWithProtein 이 이 미만이면 표본이 얇아 오해 위험 → risk assessor 에
// null 로 전달. weight-loss MCP tool 과 동일 정책.
const MIN_PROTEIN_DAYS_FOR_ASSESSMENT = 4;
// Codex P2 (PR #300 6회차): 결손 데이터도 동일 gate. 1-2일치로 7일 평균을 대체 못 함.
const MIN_DEFICIT_DAYS_FOR_ASSESSMENT = 4;

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
          // Codex P2 (PR #300 4회차): terminal vs pending 구분에 필요.
          nutritionAttempts: true,
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
        // Codex P2 (PR #300): 실제 Z4+Z5 초를 합해야 함.
        select: { zoneDistribution: true },
      }),
      prisma.userProfile.findFirst({
        select: { proteinTargetPerKg: true },
      }),
    ]);

  const macroAvg = averageMacros(macros7d);
  const bodyWeightKg = latestWeight?.weight ?? null;
  const targetPerKg = profile?.proteinTargetPerKg ?? 1.6;

  // muscle-loss input
  // Codex P2 (PR #300): 결손 유효 표본 없으면 null (0 취급 금지 — "안전" 오인 방지).
  // Codex P2 (PR #300 6회차): 커버리지 gate — 1~2일치로 7일 평균 대체 금지.
  const validBalances = latestBalances.filter(
    (b): b is { calorieBalance: number } => b.calorieBalance !== null,
  );
  const avgDailyBalanceRaw =
    validBalances.length > 0
      ? validBalances.reduce((s, b) => s + b.calorieBalance, 0) / validBalances.length
      : null;
  const avgDailyBalance =
    validBalances.length >= MIN_DEFICIT_DAYS_FOR_ASSESSMENT ? avgDailyBalanceRaw : null;
  const proteinPerKgRaw =
    macroAvg.avgProteinG !== null && bodyWeightKg
      ? macroAvg.avgProteinG / bodyWeightKg
      : null;
  // Codex P2 (PR #300): daysWithProtein 이 표본 미만이면 risk assessor 에 null 전달.
  const proteinPerKg =
    macroAvg.daysWithProtein >= MIN_PROTEIN_DAYS_FOR_ASSESSMENT ? proteinPerKgRaw : null;
  // Codex P2 (PR #300): 실제 Z4+Z5 초를 합해 분으로. intensityLabel-based full duration 은 과대 산정.
  // Codex P2 (PR #300 11회차): zone 데이터가 하나라도 누락된 활동이 있으면 카운트가 과소 산정
  // 될 수 있음 → risk assessor 에는 null 전달 (활동이 아예 없으면 진짜 0 이니 별개 처리).
  let missingZone = 0;
  const highIntensitySeconds = activities7d.reduce((s, a) => {
    const dist = parseZoneDistribution(a.zoneDistribution);
    if (!dist) {
      missingZone++;
      return s;
    }
    return s + dist.z4 + dist.z5;
  }, 0);
  const highIntensityMinutes =
    missingZone > 0 ? null : Math.round(highIntensitySeconds / 60);

  const verdict = assessMuscleLossRisk({
    weeklyCalorieDeficit: avgDailyBalance !== null ? -avgDailyBalance : null,
    avgProteinPerKg: proteinPerKg,
    weeklyHighIntensityMin: highIntensityMinutes,
    proteinTargetPerKg: targetPerKg,
    bodyWeightKg,
  });

  // 오늘 매크로 (도넛 today view 용).
  // Codex P2 (PR #300): 오늘 로그가 없으면 "측정 0" 이 아니라 "데이터 없음" 이므로 모두 null.
  // Codex P2 (PR #300 12회차): kcal 도 별도 aggregate → 도넛 센터 표시 (macro-derived 는 ±25% 오차).
  const todayMacros = todayLogs.length === 0
    ? {
        proteinG: null as number | null,
        carbsG: null as number | null,
        fatG: null as number | null,
        kcal: null as number | null,
      }
    : todayLogs.reduce<{
        proteinG: number | null;
        carbsG: number | null;
        fatG: number | null;
        kcal: number | null;
      }>(
        (acc, r) => ({
          proteinG:
            acc.proteinG === null ? null : r.proteinG === null ? null : acc.proteinG + r.proteinG,
          carbsG:
            acc.carbsG === null ? null : r.carbsG === null ? null : acc.carbsG + r.carbsG,
          fatG: acc.fatG === null ? null : r.fatG === null ? null : acc.fatG + r.fatG,
          kcal:
            acc.kcal === null ? null : r.estimatedKcal === null ? null : acc.kcal + r.estimatedKcal,
        }),
        { proteinG: 0, carbsG: 0, fatG: 0, kcal: 0 },
      );

  // Codex P2 (PR #300 6회차): 도넛/밸런스 UI 는 하루의 P/C/F 조합 비율이 의미 있는 지표.
  // 세 필드 독립 평균 (averageMacros) 을 합치면 실존하지 않는 day 를 만들 수 있음
  // (예: P avg 는 1일치, C avg 는 다른 1일치, F avg 는 세 번째 날). completeMacroAvg 는
  // 세 값 전부 non-null 인 일자만으로 평균 → 물리적으로 성립하는 하루 조합만 노출.
  const completeAvg = averageCompleteMacros(macros7d);
  const weeklyMacros = {
    proteinG: completeAvg.avgProteinG,
    carbsG: completeAvg.avgCarbsG,
    fatG: completeAvg.avgFatG,
    // Codex P2 (PR #300 12회차): 도넛 센터용 저장 kcal 평균 (macro-derived 대신).
    kcal: completeAvg.avgKcal,
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

  // Codex P2 (PR #300 4회차): pending (backfill 재시도 대상) 과 terminal (attempts 상한
  // 도달로 영구 미측정) 분리. terminal 은 "backfill 대기" 라 표현하면 오해.
  let pendingToday = 0;
  let terminalToday = 0;
  for (const l of todayLogs) {
    const anyNull =
      l.estimatedKcal == null ||
      l.proteinG == null ||
      l.carbsG == null ||
      l.fatG == null;
    if (!anyNull) continue;
    const kcalMissing = l.estimatedKcal == null;
    const attemptsExhausted = (l.nutritionAttempts ?? 0) >= MAX_NUTRITION_ATTEMPTS;
    // kcal null 은 무제한 재시도, macro-only + attempts 상한 도달만 terminal.
    if (!kcalMissing && attemptsExhausted) {
      terminalToday++;
    } else {
      pendingToday++;
    }
  }

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
        {(pendingToday > 0 || terminalToday > 0) && (
          <div className="mb-3">
            <BackfillNotice pendingCount={pendingToday} terminalCount={terminalToday} />
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
