/**
 * #378: Garmin 성과통계 장기 이력 — VO2max(일별) · 러닝 젖산역치(감지일). FitnessMetricDaily 기반.
 *
 * get_metric_history 는 앱이 프로필 스냅샷 변화를 기록한 로그(2026-04 이후)만 보므로, Garmin 보유 전 기간
 * (VO2max 2020-06~, LT 2023-05~) 질문은 이 도구로 답한다. user-profile.ts 의 스냅샷 로직은 건드리지
 * 않는다 (F5) — 두 소스가 다를 때 AI 가 혼동하지 않도록 current.asOf 로 기준일을 명시한다.
 */
import prisma from "../prisma";
import { todayKSTString, ymdKST } from "@/lib/garmin/utils";
import {
  aggregateDaily,
  bucketKeyKST,
  formatPaceMinKm,
  kstWindowEndingAt,
  promoteGranularity,
  resolveGranularity,
  type Granularity,
} from "./aggregate";
import { MAX_DAILY_ROWS } from "./constants";

export interface FitnessMetricTrendArgs {
  days?: number;
  granularity?: Granularity;
  endDate?: string;
}

const DEFAULT_DAYS = 365;

interface MetricRow {
  date: Date;
  vo2maxRunning: number | null;
  lthr: number | null;
  lthrPace: number | null;
  fitnessAge: number | null;
}

interface Detection {
  date: string;
  lthr: number | null;
  lthrPace: number | null;
  lthrPaceFormatted: string | null;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function resolveWindow(
  days: number,
  endDate?: string,
): { since: Date; until: Date | null; to: string } {
  if (!endDate) return { since: daysAgo(days), until: null, to: todayKSTString() };
  const w = kstWindowEndingAt(days, endDate);
  return { since: w.since, until: w.until, to: endDate };
}

function fmtPace(secPerKm: number | null): string | null {
  return secPerKm === null ? null : formatPaceMinKm(secPerKm);
}

/** LT 는 Garmin 이 감지한 날만 row 에 값이 있다 — 그 날들만 추린 희소 목록 (날짜 오름차순). */
function toDetections(rows: readonly MetricRow[]): Detection[] {
  return rows
    .filter((r) => r.lthr !== null || r.lthrPace !== null)
    .map((r) => ({
      date: ymdKST(r.date),
      lthr: r.lthr,
      lthrPace: r.lthrPace,
      lthrPaceFormatted: fmtPace(r.lthrPace),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 버킷마다 그 구간의 마지막 감지값 (평균 X — 감지 이벤트라 평균은 의미 없음). */
function latestDetectionPerBucket(
  rows: readonly MetricRow[],
  g: Granularity,
): Map<string, Detection> {
  const map = new Map<string, Detection>();
  for (const r of [...rows].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    if (r.lthr === null && r.lthrPace === null) continue;
    map.set(bucketKeyKST(r.date, g), {
      date: ymdKST(r.date),
      lthr: r.lthr,
      lthrPace: r.lthrPace,
      lthrPaceFormatted: fmtPace(r.lthrPace),
    });
  }
  return map;
}

function bestOf(rows: readonly MetricRow[]) {
  const vo2 = rows.filter((r) => r.vo2maxRunning !== null);
  const pace = rows.filter((r) => r.lthrPace !== null);
  const bestVo2 = vo2.length
    ? vo2.reduce((best, r) => ((r.vo2maxRunning ?? 0) > (best.vo2maxRunning ?? 0) ? r : best))
    : null;
  const bestPace = pace.length
    ? pace.reduce((best, r) => ((r.lthrPace ?? Infinity) < (best.lthrPace ?? Infinity) ? r : best))
    : null;
  return {
    vo2max: bestVo2
      ? { date: ymdKST(bestVo2.date), value: bestVo2.vo2maxRunning }
      : null,
    lthrPace: bestPace
      ? {
          date: ymdKST(bestPace.date),
          value: bestPace.lthrPace,
          formatted: fmtPace(bestPace.lthrPace),
          lthr: bestPace.lthr,
        }
      : null,
  };
}

export async function getFitnessMetricTrend(args: FitnessMetricTrendArgs) {
  const days = args.days ?? DEFAULT_DAYS;
  const requested = resolveGranularity(days, args.granularity);
  const { since, until, to } = resolveWindow(days, args.endDate);

  const rows: MetricRow[] = await prisma.fitnessMetricDaily.findMany({
    where: { date: until ? { gte: since, lt: until } : { gte: since } },
    orderBy: { date: "desc" },
    select: { date: true, vo2maxRunning: true, lthr: true, lthrPace: true, fitnessAge: true },
  });

  const base = {
    from: ymdKST(since),
    to,
    days,
  };

  if (rows.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            ...base,
            granularity: requested,
            count: 0,
            current: null,
            best: { vo2max: null, lthrPace: null },
            records: [],
            _context:
              "해당 기간 Garmin 성과통계 이력 없음. VO2max 는 2020-06, 러닝 젖산역치는 2023-05 부터 보유 — get_data_coverage 의 fitness_metrics 로 범위 확인. 최신 프로필값은 get_user_profile.",
          }),
        },
      ],
    };
  }

  // rows 는 최신순 — [0] 이 창 안 최신 row. 값별 최신은 null 이 아닌 가장 늦은 row.
  const latest = rows[0];
  const latestWith = (pick: (r: MetricRow) => number | null) =>
    rows.find((r) => pick(r) !== null) ?? null;
  const latestVo2 = latestWith((r) => r.vo2maxRunning);
  const latestLt = latestWith((r) => r.lthr ?? r.lthrPace);
  const current = {
    asOf: ymdKST(latest.date),
    vo2maxRunning: latestVo2?.vo2maxRunning ?? null,
    vo2maxAsOf: latestVo2 ? ymdKST(latestVo2.date) : null,
    lthr: latestLt?.lthr ?? null,
    lthrPace: latestLt?.lthrPace ?? null,
    lthrPaceFormatted: fmtPace(latestLt?.lthrPace ?? null),
    lthrAsOf: latestLt ? ymdKST(latestLt.date) : null,
    fitnessAge: latestWith((r) => r.fitnessAge)?.fitnessAge ?? null,
  };

  const { granularity, promoted } = promoteGranularity(requested, days, rows.length);
  const detections = toDetections(rows);

  const records =
    granularity === "daily"
      ? rows.map((r) => ({
          date: ymdKST(r.date),
          vo2maxRunning: r.vo2maxRunning,
          lthr: r.lthr,
          lthrPace: r.lthrPace,
          lthrPaceFormatted: fmtPace(r.lthrPace),
          fitnessAge: r.fitnessAge,
        }))
      : (() => {
          const perBucket = latestDetectionPerBucket(rows, granularity);
          return aggregateDaily(rows, granularity, {
            fields: ["vo2maxRunning", "fitnessAge"],
            minMax: ["vo2maxRunning"],
          }).map((b) => {
            const d = perBucket.get(b.bucket) ?? null;
            return {
              ...b,
              lthr: d?.lthr ?? null,
              lthrPace: d?.lthrPace ?? null,
              lthrPaceFormatted: d?.lthrPaceFormatted ?? null,
              lthrDetectedOn: d?.date ?? null,
            };
          });
        })();

  const response = {
    ...base,
    granularity,
    count: records.length,
    current,
    best: bestOf(rows),
    lthrDetections: detections,
    records,
    _context: [
      "Garmin 성과통계 이력 (FitnessMetricDaily). vo2maxRunning 은 거의 매일 1값, lthr/lthrPace 는 Garmin 이 젖산역치를 새로 감지한 날에만 기록되므로 빈 구간은 직전 값이 유지되는 것으로 해석한다 (lthrDetections 가 감지 이벤트 목록).",
      granularity === "daily"
        ? "records 는 일별 원본."
        : `records 는 ${granularity} 집계 — vo2maxRunning 은 {avg,min,max}, fitnessAge 는 평균, lthr/lthrPace 는 그 버킷의 마지막 감지값(lthrDetectedOn) 이며 감지가 없는 버킷은 null.`,
      promoted
        ? `daily 요청 결과가 ${MAX_DAILY_ROWS}행을 초과해 ${granularity} 로 집계했습니다. 특정 시기는 endDate=<시기 끝> · days=<폭> 으로 daily 재조회.`
        : null,
      "current 는 창 안 최신값이며 asOf/vo2maxAsOf/lthrAsOf 가 기준일. get_user_profile 의 VO2max/LTHR 은 프로필 스냅샷(다른 소스)이라 값·날짜가 다를 수 있다 — '지금' 값은 프로필, '언제 얼마였나' 는 이 도구.",
      "best.vo2max 는 창 안 최고 VO2max 날짜·값, best.lthrPace 는 가장 빠른 젖산역치 페이스(sec/km 최저) 날짜·값.",
    ]
      .filter((s): s is string => s !== null)
      .join(" "),
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
  };
}
