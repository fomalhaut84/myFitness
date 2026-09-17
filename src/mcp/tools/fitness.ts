import prisma from "../prisma";
import { ymdKST, todayKSTString } from "@/lib/garmin/utils";
import {
  aggregateActivities,
  aggregateDaily,
  formatPaceMinKm,
  promoteGranularity,
  resolveGranularity,
  type Granularity,
} from "./aggregate";
import { MAX_DAILY_ROWS } from "./constants";

// #377: 장기 조회 공통 인자. granularity 생략 시 days 기준 자동 (aggregate.ts).
export interface RangeArgs {
  days?: number;
  granularity?: Granularity;
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

/** #377: 모든 기간 조회 도구가 같은 envelope 를 돌려준다 (daily 포함). */
function envelope(
  days: number,
  since: Date,
  granularity: Granularity,
  records: readonly unknown[],
  context?: Record<string, string>,
) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            granularity,
            from: fmt(since),
            to: todayKSTString(),
            days,
            count: records.length,
            records,
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
  "weekly/monthly 는 버킷(KST 기준 ISO 주/월) 집계: 숫자 필드는 null 제외 평균. 최상위 count 는 버킷 수, 각 버킷의 count 는 그 구간의 레코드 수. weekly 의 weekStart 는 ISO 주 월요일(from 은 실제 첫 레코드 날짜). 아래 항목별 임계(7일 평균 대비 5bpm 등)는 daily 값 기준이므로 집계값에는 추세 판단용으로만 적용. 특정 구간을 자세히 보려면 그 구간만 days 를 좁혀 granularity=daily 로 재조회.";

/** M2: daily 요청이 행 상한을 넘어 집계로 승격됐을 때 _context 에 붙일 안내. */
function promotedNote(granularity: Granularity): string {
  return `daily 요청 결과가 ${MAX_DAILY_ROWS}행을 초과해 ${granularity} 로 집계했습니다. 특정 구간은 days 를 좁혀 daily 로 재조회하세요.`;
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
  const since = daysAgo(days);
  const where = args.type
    ? { startTime: { gte: since }, activityType: { contains: args.type } }
    : { startTime: { gte: since } };

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
    },
  });

  const { granularity, context } = finalizeGranularity(requested, days, activities.length, {
    granularity:
      GRANULARITY_NOTE + " 활동은 버킷 × activityType 별. avgPace 는 거리 가중, avgHR 은 시간 가중.",
  });
  if (granularity !== "daily") {
    return envelope(days, since, granularity, aggregateActivities(activities, granularity), context);
  }

  return envelope(
    days,
    since,
    granularity,
    activities.map((a) => ({
      ...a,
      // get_activity_splits 호출 시 사용할 ID (cuid 또는 garminId 문자열)
      garminId: a.garminId.toString(),
      startTime: a.startTime.toISOString(),
      distanceKm: a.distance ? (a.distance / 1000).toFixed(2) : null,
      paceMinKm: a.avgPace ? formatPaceMinKm(a.avgPace) : null,
      durationMin: Math.round(a.duration / 60),
    })),
  );
}

export async function getSleep(args: RangeArgs) {
  const days = args.days ?? 14;
  const requested = resolveGranularity(days, args.granularity);
  const since = daysAgo(days);
  const records = await prisma.sleepRecord.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "desc" },
    select: {
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
    },
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
    return envelope(
      days,
      since,
      granularity,
      aggregateDaily(records, granularity, { minMax: ["sleepScore", "hrvOvernight"] }),
      context,
    );
  }

  return envelope(
    days,
    since,
    granularity,
    records.map((r) => ({
      ...r,
      date: fmt(r.date),
      sleepStart: r.sleepStart.toISOString(),
      sleepEnd: r.sleepEnd.toISOString(),
      totalSleepHours: (r.totalSleep / 60).toFixed(1),
    })),
    context,
  );
}

export async function getHeartRate(args: RangeArgs) {
  const days = args.days ?? 30;
  const requested = resolveGranularity(days, args.granularity);
  const since = daysAgo(days);
  const records = await prisma.heartRateRecord.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "desc" },
    select: {
      date: true,
      restingHR: true,
      avgHR: true,
      maxHR: true,
      minHR: true,
      hrvStatus: true,
    },
  });

  const { granularity, context } = finalizeGranularity(requested, days, records.length, {
    granularity: GRANULARITY_NOTE,
  });
  if (granularity !== "daily") {
    return envelope(
      days,
      since,
      granularity,
      aggregateDaily(records, granularity, { minMax: ["restingHR", "hrvStatus"] }),
      context,
    );
  }

  return envelope(
    days,
    since,
    granularity,
    records.map((r) => ({ ...r, date: fmt(r.date) })),
  );
}

export async function getDailyStats(args: RangeArgs) {
  const days = args.days ?? 14;
  const requested = resolveGranularity(days, args.granularity);
  const since = daysAgo(days);
  const records = await prisma.dailySummary.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "desc" },
    select: {
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
    },
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
    return envelope(
      days,
      since,
      granularity,
      aggregateDaily(records, granularity, { minMax: ["restingHR", "bodyBatteryHigh"] }),
      context,
    );
  }

  return envelope(
    days,
    since,
    granularity,
    records.map((r) => ({ ...r, date: fmt(r.date) })),
    context,
  );
}

export async function getBodyComposition(args: RangeArgs) {
  const days = args.days ?? 90;
  const requested = resolveGranularity(days, args.granularity);
  const since = daysAgo(days);
  const records = await prisma.bodyComposition.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "desc" },
    select: {
      date: true,
      weight: true,
      bmi: true,
      bodyFat: true,
      muscleMass: true,
    },
  });

  const { granularity, context } = finalizeGranularity(requested, days, records.length, {
    granularity: GRANULARITY_NOTE + " weight/bodyFat 은 avg·min·max 동시 제공 (최저 체중 시기 탐색용).",
  });
  if (granularity !== "daily") {
    return envelope(
      days,
      since,
      granularity,
      aggregateDaily(records, granularity, { minMax: ["weight", "bodyFat"] }),
      context,
    );
  }

  return envelope(
    days,
    since,
    granularity,
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
