import prisma from "../prisma";
import { ymdKST, todayKSTString } from "@/lib/garmin/utils";
import {
  aggregateActivities,
  aggregateDaily,
  formatPaceMinKm,
  kstWindowEndingAt,
  promoteGranularity,
  resolveGranularity,
  type Granularity,
} from "./aggregate";
import { MAX_DAILY_ROWS } from "./constants";
import { activityTypeWhere } from "./activity-filter";
// #455: 일별 창 합계 (강도 분 · 층수) · 수면 규칙성 — daily envelope 에만
import { summarizeDailyWindow } from "@/lib/fitness/daily-window";
import { sleepRegularity } from "@/lib/sleep/regularity";
// #444: 러닝 창 요약 (존 80/20 · 2분 HRR 중앙값) — 주간 리포트가 이번 주 vs 직전 4주를 같은 정의로 비교
import { summarizeRunningWindow, toZonePct, toZoneSec } from "@/lib/fitness/running-window";

// #377: 장기 조회 공통 인자. granularity 생략 시 days 기준 자동 (aggregate.ts).
// endDate (Codex P1 PR #379): 과거 특정 시기를 daily 로 재조회할 때의 종료일 (KST, 포함). 생략 시 오늘.
export interface RangeArgs {
  days?: number;
  granularity?: Granularity;
  endDate?: string;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

// #364: 서버 로컬 TZ getter 는 호스트가 KST 일 때만 맞다. ecosystem.config.js 가 TZ 를
// 고정하지 않으므로 (세 앱 모두) 호스트 TZ 변경 한 번에 라벨이 하루 밀린다. KST 고정.
function fmt(date: Date): string {
  return ymdKST(date);
}

/** 조회 창. endDate 없으면 기존 daysAgo(days)~오늘, 있으면 [endDate-days, endDate] (KST). */
function resolveWindow(
  days: number,
  endDate?: string,
): { since: Date; until: Date | null; to: string } {
  if (!endDate) return { since: daysAgo(days), until: null, to: todayKSTString() };
  const w = kstWindowEndingAt(days, endDate);
  return { since: w.since, until: w.until, to: endDate };
}

/** select 키에서 숫자 집계 대상만 (date 와 시각/문자열 필드 제외). 구간 전체 null 인 지표도 null 로 남긴다. */
function numericFields(select: Record<string, true>, exclude: readonly string[]): string[] {
  return Object.keys(select).filter((k) => k !== "date" && !exclude.includes(k));
}

function dateFilter(since: Date, until: Date | null) {
  return until ? { gte: since, lt: until } : { gte: since };
}

/** #377: 모든 기간 조회 도구가 같은 envelope 를 돌려준다 (daily 포함). */
function envelope(
  days: number,
  from: string,
  to: string,
  granularity: Granularity,
  records: readonly unknown[],
  context?: Record<string, string>,
  extra?: Record<string, unknown>,
) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            granularity,
            from,
            to,
            days,
            count: records.length,
            records,
            ...(extra ?? {}),
            ...(context ? { _context: context } : {}),
          },
          null,
          2,
        ),
      },
    ],
  };
}

const GRANULARITY_NOTE =
  "weekly/monthly 는 버킷(KST 기준 ISO 주/월) 집계: 숫자 필드는 null 제외 평균. 최상위 count 는 버킷 수, 각 버킷의 count 는 그 구간의 레코드 수. weekly 의 weekStart 는 ISO 주 월요일(from 은 실제 첫 레코드 날짜). 아래 항목별 임계(7일 평균 대비 5bpm 등)는 daily 값 기준이므로 집계값에는 추세 판단용으로만 적용. 특정 구간을 자세히 보려면 endDate=<그 시기 끝> 과 days=<폭> 으로 granularity=daily 재조회 (과거 시기도 endDate 로 정확히 지정 가능).";

/** #444: daily 활동 응답의 존 · HRR · runningSummary 해석 안내 */
const ACTIVITY_DAILY_NOTES = {
  // 릴리즈 PR #457 Codex P2: hrrDrop10 은 "10bpm 까지 걸린 초" 가 아니라 종료 − 10분 후 심박 (bpm) — recoveryCurve().drop10
  hrr2: "종료 후 2분 심박 회복 = 종료 심박 − 2분 후 심박 (bpm, 양수 = 회복 · 클수록 좋음). hrrDrop10 은 같은 방식의 10분 후 값 (bpm). null 은 종료 후 시계열 없음 (2026-04 이전 · 미착용) 또는 그 시점 샘플 부족.",
  zones: "zones 는 존별 초 (개인 HR 존), zonePct 는 존 시간 합 기준 % (존마다 반올림이라 합이 99~101 일 수 있음 — 언급하지 말 것). 둘 다 null 이면 그 활동에 존 분포 없음.",
  runningSummary:
    "daily 응답에만 — 창 안 러닝 계열 요약. easyPct = Z1+Z2 시간 비율 (%), hardPct = Z4+Z5, Z3 은 중간. 80/20 = 이지 비율 80% 안팎이 polarized 기준. hrr2 는 창 안 러닝의 2분 HRR 중앙값 (n 건). withZones 가 n 보다 작으면 존 없는 활동은 비율에서 빠진 것. endDate 없는 창은 오늘 포함 — 직전 기간과 비교하려면 endDate 로 창을 나눠 두 번 조회.",
};

/** M2: daily 요청이 행 상한을 넘어 집계로 승격됐을 때 _context 에 붙일 안내. */
function promotedNote(granularity: Granularity): string {
  return `daily 요청 결과가 ${MAX_DAILY_ROWS}행을 초과해 ${granularity} 로 집계했습니다. 특정 구간은 endDate=<시기 끝> · days=<폭> 으로 daily 재조회하세요.`;
}

/** 요청 granularity 확정 → 조회 → 행 상한 초과 시 승격. 컨텍스트에 승격 안내 병합. */
function finalizeGranularity(
  requested: Granularity,
  days: number,
  rowCount: number,
  context: Record<string, string> | undefined,
): { granularity: Granularity; context: Record<string, string> | undefined } {
  const { granularity, promoted } = promoteGranularity(requested, days, rowCount);
  if (!promoted) return { granularity, context };
  return { granularity, context: { ...(context ?? {}), promoted: promotedNote(granularity) } };
}

export async function getActivities(args: RangeArgs & { type?: string }) {
  const days = args.days ?? 14;
  const requested = resolveGranularity(days, args.granularity);
  const { since, until, to } = resolveWindow(days, args.endDate);
  // PR #456 Codex P2: "running" 은 공용 러닝 판정 (virtual_run · obstacle_run 포함)
  const typeWhere = activityTypeWhere(args.type);
  const where = typeWhere ? { AND: [{ startTime: dateFilter(since, until) }, typeWhere] } : { startTime: dateFilter(since, until) };

  const activities = await prisma.activity.findMany({
    where,
    orderBy: { startTime: "desc" },
    select: {
      id: true,
      garminId: true,
      name: true,
      activityType: true,
      startTime: true,
      duration: true,
      distance: true,
      avgPace: true,
      avgHR: true,
      maxHR: true,
      calories: true,
      elevationGain: true,
      trainingEffect: true,
      vo2maxEstimate: true,
      // M4-5: 강도 자동 분류
      estimatedZone: true,
      intensityLabel: true,
      intensityScore: true,
      // #275: M2 러닝 다이나믹스 — 스키마·웹 UI 엔 있지만 AI 응답에 안 실려 "누락" 오답 발생.
      avgCadence: true,
      avgStrideLength: true,
      avgVerticalOscillation: true,
      avgGroundContactTime: true,
      aerobicTE: true,
      anaerobicTE: true,
      avgRespirationRate: true,
      // #267: 사용자 커스텀 코스명 태그 (AI 가 태그로 활동 그룹 인식)
      routeTag: true,
      // #269: 손목 온도 (Garmin, 참고용) + 외부 기상 (Open-Meteo, 활동 시작 시점)
      wristTempMaxC: true,
      wristTempMinC: true,
      weatherTempC: true,
      weatherApparentTempC: true,
      weatherHumidityPct: true,
      weatherWindMs: true,
      weatherPrecipMm: true,
      weatherCode: true,
      // #444 (A1 · A2): 2분 HRR (#425) · 존 분포 (M4-5) — 리포트가 볼 수 있게. daily 행 + runningSummary 에만 (집계 경로는 Phase 2 제외)
      hrr2: true,
      hrrDrop10: true,
      zoneDistribution: true,
    },
  });

  const { granularity, context } = finalizeGranularity(requested, days, activities.length, {
    granularity:
      GRANULARITY_NOTE + " 활동은 버킷 × activityType 별. avgPace 는 거리 가중, avgHR 은 시간 가중.",
  });
  if (granularity !== "daily") {
    return envelope(days, fmt(since), to, granularity, aggregateActivities(activities, granularity), context);
  }

  return envelope(days, fmt(since), to, granularity,
    activities.map(({ zoneDistribution, ...a }) => ({
      ...a,
      // get_activity_splits · get_activity_context 호출 시 사용할 ID (cuid 또는 garminId 문자열)
      garminId: a.garminId.toString(),
      startTime: a.startTime.toISOString(),
      distanceKm: a.distance ? (a.distance / 1000).toFixed(2) : null,
      paceMinKm: a.avgPace ? formatPaceMinKm(a.avgPace) : null,
      durationMin: Math.round(a.duration / 60),
      // #444 F1: 존별 초 · % (합 0 이거나 없으면 null)
      zones: toZoneSec(zoneDistribution),
      zonePct: toZonePct(zoneDistribution),
    })),
    // 사전 리뷰 info 1: daily 에는 필드 설명만 (버킷 설명은 집계 응답에만), 승격 안내는 finalizeGranularity 가 준 것 유지
    { ...ACTIVITY_DAILY_NOTES, ...(context?.promoted ? { promoted: context.promoted } : {}) },
    // #444 F2: 창 안 러닝 계열 요약 (러닝 아닌 type 필터여도 러닝만 센다 → n=0)
    { runningSummary: summarizeRunningWindow(activities) },
  );
}

const SLEEP_SELECT = {
  date: true,
  totalSleep: true,
  deepSleep: true,
  lightSleep: true,
  remSleep: true,
  awakeDuration: true,
  sleepScore: true,
  sleepStart: true,
  sleepEnd: true,
  avgSpO2: true,
  lowestSpO2: true,
  highestSpO2: true,
  avgRespiration: true,
  lowestRespiration: true,
  highestRespiration: true,
  avgSleepStress: true,
  bodyBatteryChange: true,
  restingHR: true,
  hrvOvernight: true,
} as const;

export async function getSleep(args: RangeArgs) {
  const days = args.days ?? 14;
  const requested = resolveGranularity(days, args.granularity);
  const { since, until, to } = resolveWindow(days, args.endDate);
  const records = await prisma.sleepRecord.findMany({
    where: { date: dateFilter(since, until) },
    orderBy: { date: "desc" },
    select: SLEEP_SELECT,
  });

  const sleepContext = {
    granularity: GRANULARITY_NOTE,
    bodyBatteryChange: "수면 중 충전량. 30+ 양호한 회복, 20-30 보통, 20 미만 회복 부족.",
    hrvOvernight: "야간 HRV. 절대값보다 7일 추세가 중요. 하락 추세 = 피로 누적, 상승 추세 = 회복 양호.",
    restingHR: "수면 중 안정시 심박. DailySummary보다 정확. 7일 평균 대비 5bpm+ 상승 시 피로/질병 의심.",
    avgSpO2: "수면 중 SpO2가 기준값. 95%+ 정상, 90% 미만 주의. null 이면 그날 밤 미측정 (기기 미착용/배터리) — DailySummary 의 주간 SpO2 로 대체 판단하지 말 것.",
    lowestSpO2: "수면 중 최저 SpO2. avgSpO2 와 임계가 다르다 — 손목 광학 센서 특성상 단발 저점은 80대 중반까지 흔하므로 절대 임계로 경고하지 말 것. 최근 7일 최저값 대비 5%p 이상 하락이 2일 이상 반복될 때만 언급.",
    highestSpO2: "수면 중 최고 SpO2. 단독 해석 가치는 낮고 lowestSpO2 와의 변동폭 판단에만 사용.",
    sleepScore: "0-100 점수. 80+ 양호, 60-80 보통, 60 미만 부족.",
  };

  const { granularity, context } = finalizeGranularity(requested, days, records.length, sleepContext);
  if (granularity !== "daily") {
    return envelope(days, fmt(since), to, granularity,
      aggregateDaily(records, granularity, { minMax: ["sleepScore", "hrvOvernight"], fields: numericFields(SLEEP_SELECT, ["sleepStart", "sleepEnd"]) }),
      context,
    );
  }

  return envelope(days, fmt(since), to, granularity,
    records.map((r) => ({
      ...r,
      date: fmt(r.date),
      sleepStart: r.sleepStart.toISOString(),
      sleepEnd: r.sleepEnd.toISOString(),
      totalSleepHours: (r.totalSleep / 60).toFixed(1),
    })),
    {
      ...context,
      regularity:
        "daily 응답에만 — 창 안 취침 · 기상 시각 (KST) 의 평균과 표준편차 (시간). label 은 취침 표준편차 기준 (0.5 / 1.0 / 1.5 시간 → 매우 규칙적 / 규칙적 / 보통 / 불규칙 — /lifestyle 과 같은 임계). 2건 미만이면 null.",
    },
    // #455 F5: 수면 규칙성
    { regularity: sleepRegularity(records) },
  );
}

const HEART_RATE_SELECT = {
  date: true,
  restingHR: true,
  avgHR: true,
  maxHR: true,
  minHR: true,
  hrvStatus: true,
} as const;

export async function getHeartRate(args: RangeArgs) {
  const days = args.days ?? 30;
  const requested = resolveGranularity(days, args.granularity);
  const { since, until, to } = resolveWindow(days, args.endDate);
  const records = await prisma.heartRateRecord.findMany({
    where: { date: dateFilter(since, until) },
    orderBy: { date: "desc" },
    select: HEART_RATE_SELECT,
  });

  const { granularity, context } = finalizeGranularity(requested, days, records.length, {
    granularity: GRANULARITY_NOTE,
  });
  if (granularity !== "daily") {
    return envelope(days, fmt(since), to, granularity,
      aggregateDaily(records, granularity, { minMax: ["restingHR", "hrvStatus"], fields: numericFields(HEART_RATE_SELECT, []) }),
      context,
    );
  }

  return envelope(days, fmt(since), to, granularity,
    records.map((r) => ({ ...r, date: fmt(r.date) })),
  );
}

const DAILY_SELECT = {
  date: true,
  steps: true,
  totalCalories: true,
  activeCalories: true,
  restingHR: true,
  avgStress: true,
  bodyBattery: true,
  bodyBatteryHigh: true,
  bodyBatteryLow: true,
  bodyBatteryCharged: true,
  bodyBatteryDrained: true,
  intensityMin: true,
  floorsClimbed: true,
  avgSpo2: true,
  lowestSpo2: true,
  avgRespiration: true,
  stressHighDuration: true,
  stressMediumDuration: true,
  stressLowDuration: true,
} as const;

export async function getDailyStats(args: RangeArgs) {
  const days = args.days ?? 14;
  const requested = resolveGranularity(days, args.granularity);
  const { since, until, to } = resolveWindow(days, args.endDate);
  const records = await prisma.dailySummary.findMany({
    where: { date: dateFilter(since, until) },
    orderBy: { date: "desc" },
    select: DAILY_SELECT,
  });

  const dailyContext = {
    granularity: GRANULARITY_NOTE,
    bodyBattery: "bodyBattery(현재값)는 하루 중 자연 소모 결과이므로 저녁에 낮은 것은 정상. 컨디션 판단은 bodyBatteryHigh(기상 시 충전값) 기준: 70+ 양호, 40-70 보통, 40 미만 피로. 회복 판단은 bodyBatteryCharged(충전량) 기준: 40+ 양호한 회복.",
    stress: "avgStress는 운동 포함 하루 평균이므로 높을 수 있음. 실제 스트레스 수준은 stressHighDuration(고스트레스 시간)과 stressLowDuration(저스트레스 시간) 비율로 판단. 운동 중 고스트레스는 정상.",
    restingHR: "DailySummary.restingHR은 주간 활동 영향을 받음. 수면 중 측정값(SleepRecord.restingHR)이 더 정확. 추세가 중요: 7일 평균 대비 5bpm 이상 상승 시 피로/질병 의심.",
    spo2: "주간 SpO2는 측정 환경에 따라 변동이 큼. 수면 중 SpO2(SleepRecord.avgSpO2)가 기준값. 95%+ 정상, 90% 미만 주의.",
  };

  const { granularity, context } = finalizeGranularity(requested, days, records.length, dailyContext);
  if (granularity !== "daily") {
    return envelope(days, fmt(since), to, granularity,
      aggregateDaily(records, granularity, { minMax: ["restingHR", "bodyBatteryHigh"], fields: numericFields(DAILY_SELECT, []) }),
      context,
    );
  }

  return envelope(days, fmt(since), to, granularity,
    records.map((r) => ({ ...r, date: fmt(r.date) })),
    {
      ...context,
      totals:
        "daily 응답에만 — 창 안 합계. intensityMinTotal 은 Garmin 강도 분 (중강도 1배 · 고강도 2배 가중) 합 — WHO 권고는 주 150분. null 은 값 있는 날이 없음 (0 이 아님). daysWithIntensity 가 days 보다 작으면 미착용 날이 있다.",
    },
    // #455 F3: 강도 분 · 층수 합계
    { totals: summarizeDailyWindow(records) },
  );
}

const BODY_SELECT = {
  date: true,
  weight: true,
  bmi: true,
  bodyFat: true,
  muscleMass: true,
} as const;

export async function getBodyComposition(args: RangeArgs) {
  const days = args.days ?? 90;
  const requested = resolveGranularity(days, args.granularity);
  const { since, until, to } = resolveWindow(days, args.endDate);
  const records = await prisma.bodyComposition.findMany({
    where: { date: dateFilter(since, until) },
    orderBy: { date: "desc" },
    select: BODY_SELECT,
  });

  const { granularity, context } = finalizeGranularity(requested, days, records.length, {
    granularity: GRANULARITY_NOTE + " weight/bodyFat 은 avg·min·max 동시 제공 (최저 체중 시기 탐색용).",
  });
  if (granularity !== "daily") {
    return envelope(days, fmt(since), to, granularity,
      aggregateDaily(records, granularity, { minMax: ["weight", "bodyFat"], fields: numericFields(BODY_SELECT, []) }),
      context,
    );
  }

  return envelope(days, fmt(since), to, granularity,
    records.map((r) => ({ ...r, date: fmt(r.date) })),
  );
}

export async function getTrends(args: { period: string }) {
  const days = args.period === "month" ? 30 : 7;
  const since = daysAgo(days);

  const [activities, dailyStats, sleepRecords] = await Promise.all([
    prisma.activity.findMany({
      where: { startTime: { gte: since } },
      select: { activityType: true, distance: true, duration: true, calories: true },
    }),
    prisma.dailySummary.findMany({
      where: { date: { gte: since } },
      select: { steps: true, activeCalories: true, avgStress: true, bodyBattery: true },
    }),
    prisma.sleepRecord.findMany({
      where: { date: { gte: since } },
      select: { totalSleep: true, sleepScore: true },
    }),
  ]);

  const avg = (arr: (number | null)[]) => {
    const valid = arr.filter((v): v is number => v !== null);
    return valid.length > 0 ? Math.round(valid.reduce((s, v) => s + v, 0) / valid.length) : null;
  };

  const totalDistance = activities.reduce((s, a) => s + (a.distance ?? 0), 0);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            period: args.period,
            days,
            activities: {
              count: activities.length,
              totalDistanceKm: (totalDistance / 1000).toFixed(2),
              totalDurationMin: Math.round(activities.reduce((s, a) => s + a.duration, 0) / 60),
              totalCalories: activities.reduce((s, a) => s + (a.calories ?? 0), 0),
            },
            daily: {
              avgSteps: avg(dailyStats.map((d) => d.steps)),
              avgActiveCalories: avg(dailyStats.map((d) => d.activeCalories)),
              avgStress: avg(dailyStats.map((d) => d.avgStress)),
              avgBodyBattery: avg(dailyStats.map((d) => d.bodyBattery)),
            },
            sleep: {
              avgTotalSleepMin: avg(sleepRecords.map((s) => s.totalSleep)),
              avgSleepScore: avg(sleepRecords.map((s) => s.sleepScore)),
            },
          },
          null,
          2
        ),
      },
    ],
  };
}
