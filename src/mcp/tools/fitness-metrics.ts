/**
 * #378: Garmin 성과통계 장기 이력 — VO2max(일별) · 러닝 젖산역치(감지일). FitnessMetricDaily 기반.
 *
 * get_metric_history 는 앱이 프로필 스냅샷 변화를 기록한 로그(2026-04 이후)만 보므로, Garmin 보유 전 기간
 * (VO2max 2020-06~, LT 2023-05~) 질문은 이 도구로 답한다. user-profile.ts 의 스냅샷 로직은 건드리지
 * 않는다 (F5) — 두 소스가 다를 때 AI 가 혼동하지 않도록 current 의 값별 asOf 로 기준일을 명시한다.
 */
import prisma from "../prisma";
import { daysAgoKST, todayKSTString, ymdKST } from "@/lib/garmin/utils";
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

/** 조회 창. endDate 없으면 [오늘-days, 오늘] (KST 자정 — 사전 리뷰 I1: 호스트 로컬 자정 금지), 있으면 [endDate-days, endDate]. */
function resolveWindow(
  days: number,
  endDate?: string,
): { since: Date; until: Date | null; to: string } {
  if (!endDate) return { since: daysAgoKST(days), until: null, to: todayKSTString() };
  const w = kstWindowEndingAt(days, endDate);
  return { since: w.since, until: w.until, to: endDate };
}

function fmtPace(secPerKm: number | null): string | null {
  return secPerKm === null ? null : formatPaceMinKm(secPerKm);
}

function toDetection(r: MetricRow): Detection {
  return {
    date: ymdKST(r.date),
    lthr: r.lthr,
    lthrPace: r.lthrPace,
    lthrPaceFormatted: fmtPace(r.lthrPace),
  };
}

function byDateAsc(rows: readonly MetricRow[]): MetricRow[] {
  return [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** LT 는 Garmin 이 감지한 날만 row 에 값이 있다 — 그 날들만 추린 희소 목록 (날짜 오름차순). */
export function toDetections(rows: readonly MetricRow[]): Detection[] {
  return byDateAsc(rows)
    .filter((r) => r.lthr !== null || r.lthrPace !== null)
    .map(toDetection);
}

/** 버킷마다 그 구간의 마지막 감지값 (평균 X — 감지 이벤트라 평균은 의미 없음). */
function latestDetectionPerBucket(
  rows: readonly MetricRow[],
  g: Granularity,
): Map<string, Detection> {
  const map = new Map<string, Detection>();
  for (const r of byDateAsc(rows)) {
    if (r.lthr === null && r.lthrPace === null) continue;
    map.set(bucketKeyKST(r.date, g), toDetection(r));
  }
  return map;
}

/**
 * 창 안 최고 VO2max / 최저(가장 빠른) 젖산역치 페이스. VO2max 는 같은 값이 수십 일 이어지는 지표라
 * 동점 plateau 의 첫날·마지막날·일수를 함께 낸다 (사전 리뷰 I3 — "가장 높았던 때" 가 하루로 좁아지지 않게).
 */
export function bestOf(rows: readonly MetricRow[]) {
  const asc = byDateAsc(rows);
  const vo2Values = asc.map((r) => r.vo2maxRunning).filter((v): v is number => v !== null);
  const paceValues = asc.map((r) => r.lthrPace).filter((v): v is number => v !== null);

  const vo2max = vo2Values.length
    ? (() => {
        const peak = Math.max(...vo2Values);
        const days = asc.filter((r) => r.vo2maxRunning === peak);
        return {
          value: peak,
          date: ymdKST(days[days.length - 1].date),
          firstDate: ymdKST(days[0].date),
          lastDate: ymdKST(days[days.length - 1].date),
          daysAtPeak: days.length,
        };
      })()
    : null;

  const lthrPace = paceValues.length
    ? (() => {
        const fastest = Math.min(...paceValues);
        const days = asc.filter((r) => r.lthrPace === fastest);
        const last = days[days.length - 1];
        return {
          value: fastest,
          formatted: fmtPace(fastest),
          date: ymdKST(last.date),
          firstDate: ymdKST(days[0].date),
          lthr: last.lthr,
          detections: days.length,
        };
      })()
    : null;

  return { vo2max, lthrPace };
}

/** 창 안 최신값 — 지표별로 따로 (사전 리뷰 I4: HR 감지일과 속도 감지일이 갈릴 수 있다). rows 는 최신순. */
export function currentOf(rows: readonly MetricRow[]) {
  if (rows.length === 0) return null;
  const latestWith = <K extends keyof MetricRow>(key: K) =>
    rows.find((r) => r[key] !== null) ?? null;
  const vo2 = latestWith("vo2maxRunning");
  const lthr = latestWith("lthr");
  const pace = latestWith("lthrPace");
  const age = latestWith("fitnessAge");
  return {
    asOf: ymdKST(rows[0].date),
    vo2maxRunning: vo2?.vo2maxRunning ?? null,
    vo2maxAsOf: vo2 ? ymdKST(vo2.date) : null,
    lthr: lthr?.lthr ?? null,
    lthrAsOf: lthr ? ymdKST(lthr.date) : null,
    lthrPace: pace?.lthrPace ?? null,
    lthrPaceFormatted: fmtPace(pace?.lthrPace ?? null),
    lthrPaceAsOf: pace ? ymdKST(pace.date) : null,
    fitnessAge: age?.fitnessAge ?? null,
  };
}

function buildRecords(rows: readonly MetricRow[], granularity: Granularity) {
  if (granularity === "daily") {
    return rows.map((r) => ({
      date: ymdKST(r.date),
      vo2maxRunning: r.vo2maxRunning,
      lthr: r.lthr,
      lthrPace: r.lthrPace,
      lthrPaceFormatted: fmtPace(r.lthrPace),
      fitnessAge: r.fitnessAge,
    }));
  }
  const perBucket = latestDetectionPerBucket(rows, granularity);
  return aggregateDaily(rows, granularity, {
    fields: ["vo2maxRunning", "fitnessAge"],
    minMax: ["vo2maxRunning"],
  }).map((b) => {
    const d = perBucket.get(b.bucket) ?? null;
    return {
      ...b,
      // 사전 리뷰 I6: fitnessAge 는 Int 도메인 — 평균을 정수로.
      fitnessAge: typeof b.fitnessAge === "number" ? Math.round(b.fitnessAge) : null,
      lthr: d?.lthr ?? null,
      lthrPace: d?.lthrPace ?? null,
      lthrPaceFormatted: d?.lthrPaceFormatted ?? null,
      lthrDetectedOn: d?.date ?? null,
    };
  });
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

  // 사전 리뷰 M2: 빈 창도 같은 스키마 (lthrDetections/best/records 키 유지) — _context 문구만 다르다.
  const { granularity, promoted } = promoteGranularity(requested, days, rows.length);
  const records = buildRecords(rows, granularity);

  const context =
    rows.length === 0
      ? "해당 기간 Garmin 성과통계 이력 없음. VO2max 는 2020-06, 러닝 젖산역치는 2023-05 부터 보유 — get_data_coverage 의 fitness_metrics 로 범위 확인. 최신 프로필값은 get_user_profile."
      : [
          "Garmin 성과통계 이력 (FitnessMetricDaily). vo2maxRunning 은 거의 매일 1값, lthr/lthrPace 는 Garmin 이 젖산역치를 새로 감지한 날에만 기록되므로 빈 구간은 직전 값이 유지되는 것으로 해석한다 (lthrDetections 가 감지 이벤트 목록).",
          granularity === "daily"
            ? "records 는 일별 원본. count 는 행 수."
            : `records 는 ${granularity} 집계 — vo2maxRunning 은 {avg,min,max}, fitnessAge 는 평균(정수), lthr/lthrPace 는 그 버킷의 마지막 감지값(lthrDetectedOn) 이며 감지가 없는 버킷은 null. 최상위 count 는 버킷 수, 각 버킷의 count 는 그 구간의 레코드 수.`,
          promoted
            ? `daily 요청 결과가 ${MAX_DAILY_ROWS}행을 초과해 ${granularity} 로 집계했습니다. 특정 시기는 endDate=<시기 끝> · days=<폭> 으로 daily 재조회.`
            : null,
          "current 는 창 안 최신값이며 지표별 기준일(vo2maxAsOf/lthrAsOf/lthrPaceAsOf)이 다를 수 있다. get_user_profile 의 VO2max/LTHR 은 프로필 스냅샷(다른 소스)이라 값·날짜가 다를 수 있다 — '지금' 값은 프로필, '언제 얼마였나' 는 이 도구.",
          "best.vo2max 는 창 안 최고 VO2max (같은 값이 이어진 plateau 의 firstDate~lastDate · daysAtPeak), best.lthrPace 는 가장 빠른 젖산역치 페이스(sec/km 최저) 와 그 감지일.",
        ]
          .filter((s): s is string => s !== null)
          .join(" ");

  const response = {
    from: ymdKST(since),
    to,
    days,
    granularity,
    count: records.length,
    current: currentOf(rows),
    best: bestOf(rows),
    lthrDetections: toDetections(rows),
    records,
    _context: context,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
  };
}
