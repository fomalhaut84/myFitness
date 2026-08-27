import prisma from "@/lib/prisma";
import { formatDateLocal } from "@/lib/format";
import { todayKST, todayKSTString, ymdKST } from "@/lib/garmin/utils";
import { startOfWeekKST, weekStartKST, parseHistoryYmd } from "@/lib/date";
import LifestyleClient from "./lifestyle-client";

export const dynamic = "force-dynamic";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function daysAgoLocal(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function kstDayRangeFor(ymd: string): { start: Date; end: Date } {
  const [y, m, d] = ymd.split("-").map(Number);
  const kstMidnightUTC = Date.UTC(y, m - 1, d) - KST_OFFSET_MS;
  return {
    start: new Date(kstMidnightUTC),
    end: new Date(kstMidnightUTC + 24 * 60 * 60 * 1000),
  };
}

export default async function LifestylePage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const now = new Date();
  // #330: /nutrition 히스토리 조회 링크에서 date 파라미터 전달받으면 오늘 음식 편집 UX 를
  // 그 날짜 로그로 적용. 다른 컨텐츠 (활동/수면/히트맵) 는 오늘 기준 유지.
  const sp = (await props.searchParams) ?? {};
  const rawDate = typeof sp.date === "string" ? sp.date : undefined;
  const todayYmd = todayKSTString();
  const selectedYmd = parseHistoryYmd(rawDate, todayYmd) ?? todayYmd;
  const isToday = selectedYmd === todayYmd;
  // #321: KST Mon 00:00 기준 (서버 로컬 TZ 대신). lifestyle 주 요약이 personal-goals
  // "이번 주 진행" 과 동일한 주 경계를 쓰도록 통일.
  const thisWeekStart = startOfWeekKST(now);
  const lastWeekStart = weekStartKST(1, now);
  const twentyEightDaysAgo = daysAgoLocal(27);
  const fourteenDaysAgo = daysAgoLocal(14);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // 이번 주 / 지난 주 활동
  const [thisWeekActivities, lastWeekActivities] = await Promise.all([
    prisma.activity.findMany({
      where: { startTime: { gte: thisWeekStart } },
      select: { startTime: true, distance: true, duration: true },
    }),
    prisma.activity.findMany({
      where: {
        startTime: { gte: lastWeekStart, lt: thisWeekStart },
      },
      select: { startTime: true, distance: true, duration: true },
    }),
  ]);

  function summarizeWeek(activities: typeof thisWeekActivities, weekStart: Date) {
    // #321 Codex P2: 주 경계는 KST-aligned 인데 그룹핑에 서버 로컬 TZ formatDateLocal 을
    // 쓰면 UTC 서버에서 KST 오전 활동이 UTC 전날로 갈라져 activeDates 과대 → restDays
    // 저평가. ymdKST 로 KST 요일 그룹핑 통일.
    const activeDates = new Set(
      activities.map((a) => ymdKST(a.startTime))
    );
    const daysInWeek = Math.min(
      7,
      Math.ceil((now.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24))
    );
    return {
      count: activities.length,
      totalDistance: activities.reduce((s, a) => s + (a.distance ?? 0), 0),
      totalDuration: activities.reduce((s, a) => s + a.duration, 0),
      restDays: Math.max(0, daysInWeek - activeDates.size),
    };
  }

  // 월간 활동 날짜 (히트맵)
  const monthlyActivities = await prisma.activity.findMany({
    where: { startTime: { gte: monthStart } },
    select: { startTime: true },
  });
  const monthlyActiveDates = Array.from(
    new Set(monthlyActivities.map((a) => formatDateLocal(a.startTime)))
  );

  // 꾸준함 (28일)
  const last28Activities = await prisma.activity.findMany({
    where: { startTime: { gte: twentyEightDaysAgo } },
    select: { startTime: true },
  });
  const last28ActiveDates = new Set(
    last28Activities.map((a) => formatDateLocal(a.startTime))
  );

  // 수면 규칙성 (14일)
  const sleepRecords = await prisma.sleepRecord.findMany({
    where: { date: { gte: fourteenDaysAgo } },
    select: { date: true, sleepStart: true, sleepEnd: true },
    orderBy: { date: "asc" },
  });

  // #283: 오늘 (KST 자정 ~ 다음날 자정) 음식 로그 — kcal 편집/삭제용.
  // 사전 리뷰 P1-2: 서버 로컬 TZ 대신 todayKST() 로 진짜 KST midnight instant 사용
  // (recalculateCalorieBalance 의 KST-day 집계와 정합).
  // #330: `?date=` 파라미터가 오늘 아니면 그 날짜 로그 fetch (편집 UX 도 그 날짜에 적용).
  const { start: dayStart, end: dayEnd } = isToday
    ? { start: todayKST(), end: new Date(todayKST().getTime() + 24 * 60 * 60 * 1000) }
    : kstDayRangeFor(selectedYmd);
  const todayFoodLogs = await prisma.foodLog.findMany({
    where: { date: { gte: dayStart, lt: dayEnd } },
    orderBy: { createdAt: "asc" },
    // #309 Codex P2 (PR #313 12회차): kcal editor snapshot 매칭용 updatedAt 함께 fetch.
    select: {
      id: true,
      date: true,
      description: true,
      mealType: true,
      estimatedKcal: true,
      updatedAt: true,
    },
  });

  const sleepEntries = sleepRecords.map((r) => {
    const start = new Date(r.sleepStart);
    const end = new Date(r.sleepEnd);
    // 취침 시간을 소수점 시간으로 (자정 이후면 그대로, 이전이면 음수 방지를 위해 -24 안 함)
    let startHour = start.getHours() + start.getMinutes() / 60;
    // 22~24시를 음수로 변환하지 않고 그대로 유지
    if (startHour > 18) startHour = startHour - 24; // 예: 23시 → -1, 자정 기준 비교용
    const endHour = end.getHours() + end.getMinutes() / 60;

    return {
      date: formatDateLocal(r.date),
      sleepStartHour: startHour,
      wakeUpHour: endHour,
    };
  });

  return (
    <LifestyleClient
      thisWeek={summarizeWeek(thisWeekActivities, thisWeekStart)}
      lastWeek={summarizeWeek(lastWeekActivities, lastWeekStart)}
      monthlyActiveDates={monthlyActiveDates}
      year={now.getFullYear()}
      month={now.getMonth() + 1}
      consistencyActiveDays={last28ActiveDates.size}
      sleepEntries={sleepEntries}
      selectedYmd={selectedYmd}
      isToday={isToday}
      todayFoodLogs={todayFoodLogs.map((f) => ({
        id: f.id,
        description: f.description,
        mealType: f.mealType,
        estimatedKcal: f.estimatedKcal,
        timeIso: f.date.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      }))}
    />
  );
}
