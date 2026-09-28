/**
 * #393 (M15-1): 히스토리 하한 = max(MIN_HISTORY_YMD, 5개 모델 실제 최초 기록일 최소값).
 *
 * `SyncMetadata.oldestFetchedDate` 는 backfill 로 **조회한** 범위(2019-06-01)라 쓰지 않는다 — 데이터가
 * 없는 2019 가 노출되고 그 라우트는 MIN_HISTORY_YMD 에 걸려 전부 되돌아간다 (PR #398 Codex P2).
 * 연도 탭 · picker min · 라우트 검증이 전부 이 값을 공유한다.
 */
import prisma from "@/lib/prisma";
import { MIN_HISTORY_YMD } from "@/lib/date";
import { todayKSTString, ymdKST } from "@/lib/garmin/utils";
import { effectiveLowerBound } from "./bounds";

/** 순수: 최초 기록일 후보(null 허용) → 하한. `todayYmd` 를 주면 하한 > 오늘을 오늘로 (#405: 미래 체중 기록만 있는 설치) */
export function clampLowerBound(earliest: readonly (string | null)[], todayYmd?: string): string {
  const present = earliest.filter((v): v is string => typeof v === "string");
  if (present.length === 0) return MIN_HISTORY_YMD;
  const min = present.reduce((a, b) => (b < a ? b : a));
  const floored = min < MIN_HISTORY_YMD ? MIN_HISTORY_YMD : min;
  return todayYmd === undefined ? floored : effectiveLowerBound(floored, todayYmd);
}

export async function getHistoryLowerBound(): Promise<string> {
  const [activity, daily, sleep, body, fitness] = await Promise.all([
    prisma.activity.findFirst({ orderBy: { startTime: "asc" }, select: { startTime: true } }),
    prisma.dailySummary.findFirst({ orderBy: { date: "asc" }, select: { date: true } }),
    prisma.sleepRecord.findFirst({ orderBy: { date: "asc" }, select: { date: true } }),
    prisma.bodyComposition.findFirst({ orderBy: { date: "asc" }, select: { date: true } }),
    prisma.fitnessMetricDaily.findFirst({ orderBy: { date: "asc" }, select: { date: true } }),
  ]);
  return clampLowerBound(
    [
      activity ? ymdKST(activity.startTime) : null,
      daily ? ymdKST(daily.date) : null,
      sleep ? ymdKST(sleep.date) : null,
      body ? ymdKST(body.date) : null,
      fitness ? ymdKST(fitness.date) : null,
    ],
    todayKSTString(),
  );
}
