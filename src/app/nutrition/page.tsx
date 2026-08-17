// #299 (M14 Phase 2 #3): /nutrition 페이지 — 매크로 · 근손실 위험.
// server component. 데이터 fetch 후 client 컴포넌트들에 props 로 전달.

import prisma from "@/lib/prisma";
import { todayKSTString } from "@/lib/garmin/utils";
import { aggregateRecentMacros, averageMacros, averageCompleteMacros } from "@/lib/nutrition/daily-macros";
import { MAX_NUTRITION_ATTEMPTS } from "@/lib/nutrition/backfill";
import { assessMuscleLossRisk, HIGH_INTENSITY_THRESHOLD_MIN } from "@/lib/fitness/muscle-loss-risk";
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
  // Codex P2 (PR #300 14회차): risk 는 완료된 KST 7일 (today-7..today-1) 필요 → 8일치 fetch.
  // trend/donut UI 는 today 포함 7일 (today-6..today) 유지 — 마지막 7일 slice 로 노출.
  const eightDaysAgo = new Date(todayStart);
  eightDaysAgo.setDate(eightDaysAgo.getDate() - 7);

  // 병렬 fetch
  const [todayLogs, macros8d, latestWeight, latestBalances, activities7d, profile] =
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
      aggregateRecentMacros(now, 8),
      prisma.bodyComposition.findFirst({
        orderBy: { date: "desc" },
        select: { weight: true },
      }),
      prisma.dailySummary.findMany({
        where: { date: { gte: eightDaysAgo } },
        // Codex P2 (PR #300 13회차): 오늘 부분값 제외 위해 date 필요.
        select: { date: true, calorieBalance: true },
      }),
      prisma.activity.findMany({
        // Codex P2 (PR #300 15회차): 활동도 risk 계산 전용 (page 는 활동 표시 없음) → 완료된
        // KST 7일 (today-7 <= startTime < today) 로 제한. 이전엔 상한 없이 오늘 활동도 포함되어
        // 오후 Z4/Z5 workout 이 score 를 30분 threshold 위로 밀어 verdict 순간 변동.
        // 단백질 · 결손 입력은 이미 오늘 필터 (validBalancesCompleted / macros7dCompleted) 인데
        // 활동만 8일/mixed window 라 판정이 일관되지 않았음.
        where: { startTime: { gte: eightDaysAgo, lt: todayStart } },
        // Codex P2 (PR #300): 실제 Z4+Z5 초를 합해야 함.
        select: { zoneDistribution: true },
      }),
      prisma.userProfile.findFirst({
        select: { proteinTargetPerKg: true },
      }),
    ]);

  // Codex P2 (PR #300 14회차): UI 표시용은 today 포함 7일 유지 (마지막 7개).
  const macros7d = macros8d.slice(-7);

  const macroAvg = averageMacros(macros7d);
  const bodyWeightKg = latestWeight?.weight ?? null;
  const targetPerKg = profile?.proteinTargetPerKg ?? 1.6;

  // muscle-loss input
  // Codex P2 (PR #300 13회차): 오늘의 부분값 (아침만 기록됐다든지) 이 risk 평가로 들어가면
  // 저녁 로그 전까지 임시 warning 발생. 완료된 KST 일자만 사용. UI 차트/식단 리스트에는 오늘
  // 포함 유지.
  // Codex P2 (PR #300 14회차): 8-day fetch 로부터 오늘 필터 → 정확히 7 완료된 KST 일.
  // macros7d.filter (7일 today 포함) 은 filter <today 후 6일밖에 안 남는 off-by-one.
  const todayYmd = todayKSTString();
  const macros7dCompleted = macros8d.filter((d) => d.date < todayYmd);
  const macroAvgCompleted = averageMacros(macros7dCompleted);
  const validBalancesCompleted = latestBalances
    .filter((b) => b.date.getTime() < todayStart.getTime())
    .filter((b): b is { date: Date; calorieBalance: number } => b.calorieBalance !== null);
  const avgDailyBalanceRaw =
    validBalancesCompleted.length > 0
      ? validBalancesCompleted.reduce((s, b) => s + b.calorieBalance, 0) /
        validBalancesCompleted.length
      : null;
  const avgDailyBalance =
    validBalancesCompleted.length >= MIN_DEFICIT_DAYS_FOR_ASSESSMENT
      ? avgDailyBalanceRaw
      : null;
  // Codex P2 (PR #303 18회차): daily 총량 rounded → aggregation 상류에서 손실. avgProteinGRaw
  // (unrounded) 로 판정해 target × 0.9 근처 false positive 방지.
  const proteinPerKgRaw =
    macroAvgCompleted.avgProteinGRaw !== null && bodyWeightKg
      ? macroAvgCompleted.avgProteinGRaw / bodyWeightKg
      : null;
  // Codex P2 (PR #300): daysWithProtein 이 표본 미만이면 risk assessor 에 null 전달.
  const proteinPerKg =
    macroAvgCompleted.daysWithProtein >= MIN_PROTEIN_DAYS_FOR_ASSESSMENT
      ? proteinPerKgRaw
      : null;
  void macroAvg;  // UI 노출용 (전체 7일 평균) 은 다른 계산 (completeAvg) 이 사용.
  // Codex P2 (PR #300): 실제 Z4+Z5 초를 합해 분으로. intensityLabel-based full duration 은 과대 산정.
  // Codex P2 (PR #300 11회차): zone 데이터 누락 활동 있으면 risk 에 null 전달.
  // Codex P2 (PR #300 13회차): measured lower bound 가 이미 threshold 초과면 known — missing
  // 이 얼마든 결론 바뀌지 않으므로 그 값 그대로 사용 (blanket null 로 HIGH downgrade 방지).
  let missingZone = 0;
  const highIntensitySeconds = activities7d.reduce((s, a) => {
    const dist = parseZoneDistribution(a.zoneDistribution);
    if (!dist) {
      missingZone++;
      return s;
    }
    return s + dist.z4 + dist.z5;
  }, 0);
  // Codex P2 (PR #301 20회차): fractional minutes 로 assessor 에 전달 (반올림 없이).
  // 30:20 초 = 30.33 분 → assessor 가 > 30 true. 이전 Math.round 는 30 으로 false negative,
  // 결손·단백질 조건과 겹치면 HIGH → MEDIUM 강등.
  const measuredMinutes = highIntensitySeconds / 60;
  const highIntensityMinutes =
    measuredMinutes > HIGH_INTENSITY_THRESHOLD_MIN
      ? measuredMinutes
      : missingZone > 0
        ? null
        : measuredMinutes;

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
        hasAnyData: false,
      }
    : {
        ...todayLogs.reduce<{
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
        ),
        // Codex P2 (PR #301 26회차): 오늘 로그가 존재하면 hasAnyData true (모든 macro/kcal 이
        // null 로 propagate 되어도 partial 로 표시).
        hasAnyData: true,
      };

  // Codex P2 (PR #300 6회차): 도넛/밸런스 UI 는 하루의 P/C/F 조합 비율이 의미 있는 지표.
  // 세 필드 독립 평균 (averageMacros) 을 합치면 실존하지 않는 day 를 만들 수 있음
  // (예: P avg 는 1일치, C avg 는 다른 1일치, F avg 는 세 번째 날). completeMacroAvg 는
  // 세 값 전부 non-null 인 일자만으로 평균 → 물리적으로 성립하는 하루 조합만 노출.
  const completeAvg = averageCompleteMacros(macros7d);
  // Codex P2 (PR #301 26/27회차): completeAvg 가 모두 null (7일 중 complete tuple 없음) 이지만
  // partial 로그는 있는 경우 "기록 없음" 오해 방지. itemCount > 0 = 로그 자체가 존재.
  // 27회차: 필드값만 체크하면 estimation 전부 실패로 모든 nutrition 필드 null 인 날이 있어도
  // "기록 없음" 처럼 보임 → itemCount 로 log-existence 판정.
  const weeklyHasAnyData = macros7d.some((d) => d.itemCount > 0);
  const weeklyMacros = {
    proteinG: completeAvg.avgProteinG,
    carbsG: completeAvg.avgCarbsG,
    fatG: completeAvg.avgFatG,
    // Codex P2 (PR #300 12회차): 도넛 센터용 저장 kcal 평균 (macro-derived 대신).
    kcal: completeAvg.avgKcal,
    hasAnyData: weeklyHasAnyData,
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
