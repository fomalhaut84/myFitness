/**
 * #377 F3: 실제 보유 범위 노출. AI 가 "도구 한도" 가 아니라 "데이터 범위" 로 답하게 한다.
 *
 * sync.ts 의 firstRecordDate 와 같은 기준(실제 레코드)이지만 MCP 번들이 garmin-connect 를
 * 끌어오지 않도록 여기서 prisma 를 직접 조회한다.
 */
import prisma from "../prisma";
import { ymdKST, todayKSTString } from "@/lib/garmin/utils";
import { getCoverageRanges } from "@/lib/history/coverage";
import { MAX_QUERY_DAYS } from "./constants";

export async function getDataCoverage() {
  // #396: 집계는 src/lib/history/coverage.ts 로 이동 — `/history` 커버리지 띠와 같은 숫자. 반환 shape 는 그대로.
  const [ranges, meta] = await Promise.all([
    getCoverageRanges(),
    prisma.syncMetadata.findMany({
      select: { dataType: true, oldestFetchedDate: true, coveredThroughDate: true, lastSyncAt: true },
    }),
  ]);
  const { activities, daily_stats, sleep, heart_rate, body_composition, blood_pressure, fitness_metrics } = ranges;
  // #378: VO2max 일별 + 젖산역치 감지일. fitness_metrics.oldest 는 VO2max 시작(2020-06)이 된다.
  const types = { activities, daily_stats, sleep, heart_rate, body_composition, blood_pressure, fitness_metrics };

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
              "types.*.oldest = DB 에 있는 가장 오래된 기록(측정이 있었던 날). syncCoverage.*.oldestFetched = Garmin 에서 가져온 하한. " +
              "두 값은 다르다: oldestFetched ≤ 날짜 < oldest 구간은 '가져왔지만 기록이 없는' 기간(예: 체중계 사용 전)이고, " +
              "oldestFetched 이전만 '아직 가져오지 않은' 구간이다 — 도구 한도가 아니다. 어느 쪽도 365 로 제한되지 않는다. " +
              "oldestFetched 가 oldest 보다 늦으면 마커가 뒤늦게 도입된 것이니(#220 이전 seed) 하한은 둘 중 이른 쪽으로. " +
              "'전체 기록' 질문은 오늘-min(oldest, oldestFetched) 를 days 로 넣고, 장기면 granularity(weekly/monthly) 로 먼저 훑은 뒤 필요한 시기만 endDate+days 로 daily 재조회.",
          },
          null,
          2,
        ),
      },
    ],
  };
}
