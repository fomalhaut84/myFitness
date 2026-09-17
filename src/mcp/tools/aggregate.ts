/**
 * #377: 장기 조회용 주/월 집계. 순수 함수 · 입력 불변.
 *
 * 버킷 라벨은 KST 벽시계 기준 (#364 규칙). weekly 는 ISO 주(월요일 시작) `YYYY-Www`,
 * monthly 는 `YYYY-MM`, daily 는 `YYYY-MM-DD`.
 */
import { ymdKST } from "@/lib/garmin/utils";
import {
  AUTO_MONTHLY_THRESHOLD_DAYS,
  AUTO_WEEKLY_THRESHOLD_DAYS,
} from "./constants";

export type Granularity = "daily" | "weekly" | "monthly";

const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveGranularity(
  days: number,
  explicit?: Granularity,
): Granularity {
  if (explicit) return explicit;
  if (days <= AUTO_WEEKLY_THRESHOLD_DAYS) return "daily";
  if (days <= AUTO_MONTHLY_THRESHOLD_DAYS) return "weekly";
  return "monthly";
}

/** KST 날짜 문자열 → UTC 자정 Date (요일/주차 산술용. instant 의미 없음). */
function ymdToUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** 합성 UTC 자정 Date → YYYY-MM-DD. (instant 가 아니라 KST 날짜의 요일 산술용 값이라 UTC getter 가 맞다.) */
function utcToYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ISO 주의 월요일 (KST 날짜 문자열). */
export function weekStartKST(date: Date): string {
  const utc = ymdToUtc(ymdKST(date));
  const dayNum = utc.getUTCDay() || 7; // Mon=1 … Sun=7
  const monday = new Date(utc.getTime() - (dayNum - 1) * DAY_MS);
  return utcToYmd(monday);
}

export function bucketKeyKST(date: Date, g: Granularity): string {
  const ymd = ymdKST(date);
  if (g === "daily") return ymd;
  if (g === "monthly") return ymd.slice(0, 7);
  // ISO 8601 주차: 그 주의 목요일이 속한 연도가 ISO 연도.
  const utc = ymdToUtc(ymd);
  const dayNum = utc.getUTCDay() || 7;
  const thursday = new Date(utc.getTime() + (4 - dayNum) * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function avgOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return round1(values.reduce((s, v) => s + v, 0) / values.length);
}

export interface MinMaxAvg {
  avg: number | null;
  min: number | null;
  max: number | null;
}

export type AggRow = {
  bucket: string;
  from: string;
  to: string;
  count: number;
} & Record<string, unknown>;

/**
 * 일별 레코드를 버킷별로 집계. `date` 외 값이 number 인 필드만 평균 (null 제외, 소수 1자리).
 * `minMax` 에 지정한 필드는 `{ avg, min, max }` 로 반환. 문자열/Date 필드는 제외.
 * 결과는 bucket 내림차순 (기존 도구의 최신순과 동일).
 */
export function aggregateDaily<T extends { date: Date }>(
  rows: readonly T[],
  g: Granularity,
  opts: { minMax?: readonly (keyof T & string)[] } = {},
): AggRow[] {
  const minMaxSet = new Set<string>(opts.minMax ?? []);
  const numericKeys = new Set<string>();
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      if (k !== "date" && typeof v === "number") numericKeys.add(k);
    }
  }

  const groups = new Map<string, { dates: string[]; values: Map<string, number[]> }>();
  for (const row of rows) {
    const key = bucketKeyKST(row.date, g);
    const group = groups.get(key) ?? { dates: [], values: new Map() };
    const ymd = ymdKST(row.date);
    const values = new Map(group.values);
    for (const k of numericKeys) {
      const v = (row as Record<string, unknown>)[k];
      if (typeof v === "number") values.set(k, [...(values.get(k) ?? []), v]);
    }
    groups.set(key, { dates: [...group.dates, ymd], values });
  }

  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([bucket, group]) => {
      const sortedDates = [...group.dates].sort();
      const fields: Record<string, unknown> = {};
      for (const k of numericKeys) {
        const vals = group.values.get(k) ?? [];
        if (minMaxSet.has(k)) {
          fields[k] = {
            avg: avgOf(vals),
            min: vals.length ? Math.min(...vals) : null,
            max: vals.length ? Math.max(...vals) : null,
          } satisfies MinMaxAvg;
        } else {
          fields[k] = avgOf(vals);
        }
      }
      return {
        bucket,
        from: sortedDates[0],
        to: sortedDates[sortedDates.length - 1],
        count: group.dates.length,
        ...fields,
      };
    });
}

export interface ActivityAggInput {
  activityType: string;
  startTime: Date;
  /** m */
  distance: number | null;
  /** s */
  duration: number;
  avgHR: number | null;
  vo2maxEstimate: number | null;
}

export interface ActivityAggRow {
  bucket: string;
  from: string;
  to: string;
  activityType: string;
  count: number;
  totalDistanceKm: number;
  totalDurationMin: number;
  /** 거리 가중 (총시간/총거리). 거리 없는 활동 제외. */
  avgPaceSecKm: number | null;
  avgPaceMinKm: string | null;
  /** 시간 가중 */
  avgHR: number | null;
  longestKm: number | null;
  avgVo2maxEstimate: number | null;
}

export function formatPaceMinKm(secPerKm: number): string {
  const t = Math.round(secPerKm);
  return `${Math.floor(t / 60)}'${String(t % 60).padStart(2, "0")}"`;
}

export function aggregateActivities(
  rows: readonly ActivityAggInput[],
  g: Granularity,
): ActivityAggRow[] {
  const groups = new Map<string, ActivityAggInput[]>();
  for (const row of rows) {
    const key = `${bucketKeyKST(row.startTime, g)}|${row.activityType}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([key, items]) => {
      const [bucket, activityType] = key.split("|");
      const dates = items.map((i) => ymdKST(i.startTime)).sort();
      const withDist = items.filter((i) => (i.distance ?? 0) > 0);
      const distM = withDist.reduce((s, i) => s + (i.distance ?? 0), 0);
      const distSec = withDist.reduce((s, i) => s + i.duration, 0);
      const totalSec = items.reduce((s, i) => s + i.duration, 0);
      const hrItems = items.filter((i) => i.avgHR !== null && i.duration > 0);
      const hrSec = hrItems.reduce((s, i) => s + i.duration, 0);
      const hrWeighted = hrItems.reduce((s, i) => s + (i.avgHR ?? 0) * i.duration, 0);
      const vo2 = items
        .map((i) => i.vo2maxEstimate)
        .filter((v): v is number => v !== null);
      const paceSec = distM > 0 ? distSec / (distM / 1000) : null;
      return {
        bucket,
        from: dates[0],
        to: dates[dates.length - 1],
        activityType,
        count: items.length,
        totalDistanceKm: Math.round((distM / 1000) * 100) / 100,
        totalDurationMin: Math.round(totalSec / 60),
        avgPaceSecKm: paceSec === null ? null : Math.round(paceSec),
        avgPaceMinKm: paceSec === null ? null : formatPaceMinKm(paceSec),
        avgHR: hrSec > 0 ? Math.round(hrWeighted / hrSec) : null,
        longestKm:
          withDist.length > 0
            ? Math.round((Math.max(...withDist.map((i) => i.distance ?? 0)) / 1000) * 100) / 100
            : null,
        avgVo2maxEstimate: avgOf(vo2),
      };
    });
}
