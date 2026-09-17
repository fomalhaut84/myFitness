/**
 * #377 F3: 실제 보유 범위 노출. AI 가 "도구 한도" 가 아니라 "데이터 범위" 로 답하게 한다.
 *
 * sync.ts 의 firstRecordDate 와 같은 기준(실제 레코드)이지만 MCP 번들이 garmin-connect 를
 * 끌어오지 않도록 여기서 prisma 를 직접 조회한다.
 */
import prisma from "../prisma";
import { ymdKST, todayKSTString } from "@/lib/garmin/utils";
import { MAX_QUERY_DAYS } from "./constants";

interface Range {
  oldest: string | null;
  newest: string | null;
  count: number;
}

function toRange(
  min: Date | null | undefined,
  max: Date | null | undefined,
  count: number,
): Range {
  return {
    oldest: min ? ymdKST(min) : null,
    newest: max ? ymdKST(max) : null,
    count,
  };
}

export async function getDataCoverage() {
  const [activity, running, daily, sleep, hr, body, bp, meta] = await Promise.all([
    prisma.activity.aggregate({
      _min: { startTime: true },
      _max: { startTime: true },
      _count: { _all: true },
    }),
    prisma.activity.aggregate({
      where: { activityType: { contains: "running" } },
      _min: { startTime: true },
      _max: { startTime: true },
      _count: { _all: true },
    }),
    prisma.dailySummary.aggregate({ _min: { date: true }, _max: { date: true }, _count: { _all: true } }),
    prisma.sleepRecord.aggregate({ _min: { date: true }, _max: { date: true }, _count: { _all: true } }),
    prisma.heartRateRecord.aggregate({ _min: { date: true }, _max: { date: true }, _count: { _all: true } }),
    prisma.bodyComposition.aggregate({ _min: { date: true }, _max: { date: true }, _count: { _all: true } }),
    prisma.bloodPressure.aggregate({ _min: { date: true }, _max: { date: true }, _count: { _all: true } }),
    prisma.syncMetadata.findMany({
      select: { dataType: true, oldestFetchedDate: true, coveredThroughDate: true, lastSyncAt: true },
    }),
  ]);

  const types = {
    activities: {
      ...toRange(activity._min.startTime, activity._max.startTime, activity._count._all),
      running: toRange(running._min.startTime, running._max.startTime, running._count._all),
    },
    daily_stats: toRange(daily._min.date, daily._max.date, daily._count._all),
    sleep: toRange(sleep._min.date, sleep._max.date, sleep._count._all),
    heart_rate: toRange(hr._min.date, hr._max.date, hr._count._all),
    body_composition: toRange(body._min.date, body._max.date, body._count._all),
    blood_pressure: toRange(bp._min.date, bp._max.date, bp._count._all),
  };

  const syncCoverage = Object.fromEntries(
    meta
      .filter((m) => m.dataType !== "user_profile")
      .map((m) => [
        m.dataType,
        {
          oldestFetched: m.oldestFetchedDate ? ymdKST(m.oldestFetchedDate) : null,
          coveredThrough: m.coveredThroughDate ? ymdKST(m.coveredThroughDate) : null,
          lastSyncAt: m.lastSyncAt.toISOString(),
        },
      ]),
  );

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            asOf: todayKSTString(),
            maxQueryDays: MAX_QUERY_DAYS,
            types,
            syncCoverage,
            _context:
              "types.*.oldest 가 실제 조회 가능 하한. 그 이전은 Garmin 에서 아직 가져오지 않은 구간이지 도구 한도가 아니다. " +
              "'전체 기록' 질문은 오늘-oldest 를 days 로 넣고, 장기면 granularity(weekly/monthly) 로 먼저 훑은 뒤 필요한 구간만 daily 로 재조회. " +
              "syncCoverage 는 싱크 엔진의 커버 마커로 실제 레코드보다 좁을 수 있다 — 조회 하한은 types 기준.",
          },
          null,
          2,
        ),
      },
    ],
  };
}
