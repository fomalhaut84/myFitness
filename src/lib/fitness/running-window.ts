// #444 F2: 러닝 창 요약 — 존 시간 합 · 80/20 (polarized) 비율 · 2분 HRR 중앙값. 순수 (prisma · Date 없음).
// `get_activities` daily 응답의 envelope 에 실려 주간 리포트가 "이번 주 vs 직전 4주" 를 같은 정의로 비교한다.
import { isRunningType } from "@/lib/activity/running-types";
import { parseZoneDistribution, type ZoneDistribution } from "@/lib/fitness/intensity";
import { median } from "@/lib/insights/stats";
import { strideMeters } from "./stride";

export interface RunningWindowRow {
  activityType: string;
  /** Prisma Json — `parseZoneDistribution` 으로 읽는다 */
  zoneDistribution: unknown;
  hrr2: number | null;
  // #455 F6: 러닝 다이나믹스 (없는 호출자는 생략 가능)
  avgCadence?: number | null;
  avgStrideLength?: number | null;
  avgGroundContactTime?: number | null;
  avgVerticalOscillation?: number | null;
}

export interface MedianStat {
  median: number;
  n: number;
}

/** 창 안 러닝 다이나믹스 중앙값 — 주간 리포트가 이번 주 vs 직전 4주를 비교 (케이던스 하락 · GCT 상승 = 피로/부상 신호) */
export interface DynamicsSummary {
  cadence: MedianStat | null;
  strideLengthM: MedianStat | null;
  groundContactTimeMs: MedianStat | null;
  verticalOscillationCm: MedianStat | null;
}

export type ZonePct = ZoneDistribution;

export interface RunningWindowSummary {
  /** 창 안 러닝 계열 활동 수 */
  n: number;
  /** 그중 존 분포가 있는 활동 수 */
  withZones: number;
  zoneTotalsSec: ZoneDistribution | null;
  /** 이지 (Z1+Z2) 시간 비율 % — 존 합 0 이면 null */
  easyPct: number | null;
  /** 하드 (Z4+Z5) 시간 비율 % — Z3 은 어느 쪽에도 안 들어간다 */
  hardPct: number | null;
  hrr2: MedianStat | null;
  dynamics: DynamicsSummary;
}

const EMPTY_ZONES: ZoneDistribution = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };

function zoneTotal(z: ZoneDistribution): number {
  return z.z1 + z.z2 + z.z3 + z.z4 + z.z5;
}

function addZones(a: ZoneDistribution, b: ZoneDistribution): ZoneDistribution {
  return { z1: a.z1 + b.z1, z2: a.z2 + b.z2, z3: a.z3 + b.z3, z4: a.z4 + b.z4, z5: a.z5 + b.z5 };
}

/** Garmin 존 시간은 소수 초 — 합계는 정수 초로 (부동소수 잔재가 응답에 실리지 않게) */
function roundZones(z: ZoneDistribution): ZoneDistribution {
  return { z1: Math.round(z.z1), z2: Math.round(z.z2), z3: Math.round(z.z3), z4: Math.round(z.z4), z5: Math.round(z.z5) };
}

function pct(part: number, total: number): number {
  return Math.round((part / total) * 100);
}

/** 존별 시간 (정수 초). 형태가 아니거나 합 0 이면 null — 행 응답용 */
export function toZoneSec(value: unknown): ZoneDistribution | null {
  const z = usableZones(value);
  return z === null ? null : roundZones(z);
}

/** 존별 시간 비율 (정수 %). 존 합 0 이거나 형태가 아니면 null */
export function toZonePct(value: unknown): ZonePct | null {
  const z = parseZoneDistribution(value);
  if (z === null) return null;
  const total = zoneTotal(z);
  if (total <= 0) return null;
  return { z1: pct(z.z1, total), z2: pct(z.z2, total), z3: pct(z.z3, total), z4: pct(z.z4, total), z5: pct(z.z5, total) };
}

/** 존 합이 양수인 분포만 (형태 불일치 · 전부 0 은 제외) */
function usableZones(value: unknown): ZoneDistribution | null {
  const z = parseZoneDistribution(value);
  return z !== null && zoneTotal(z) > 0 ? z : null;
}

function medianStat(values: readonly (number | null | undefined)[], decimals: number): MedianStat | null {
  const present = values.flatMap((v) => (v === null || v === undefined ? [] : [v]));
  const m = median(present);
  return m === null ? null : { median: Number(m.toFixed(decimals)), n: present.length };
}

function summarizeDynamics(runs: readonly RunningWindowRow[]): DynamicsSummary {
  return {
    cadence: medianStat(runs.map((r) => r.avgCadence), 0),
    // cm 혼재 행 (파서 정정 이전) 을 m 로 — 활동 평가와 같은 규칙
    strideLengthM: medianStat(runs.map((r) => (r.avgStrideLength == null ? null : strideMeters(r.avgStrideLength))), 2),
    groundContactTimeMs: medianStat(runs.map((r) => r.avgGroundContactTime), 0),
    verticalOscillationCm: medianStat(runs.map((r) => r.avgVerticalOscillation), 1),
  };
}

export function summarizeRunningWindow(rows: readonly RunningWindowRow[]): RunningWindowSummary {
  const runs = rows.filter((r) => isRunningType(r.activityType));
  const zones = runs.flatMap((r) => {
    const z = usableZones(r.zoneDistribution);
    return z === null ? [] : [z];
  });
  const totals = zones.length > 0 ? roundZones(zones.reduce(addZones, EMPTY_ZONES)) : null;
  const total = totals === null ? 0 : zoneTotal(totals);
  const hrrValues = runs.flatMap((r) => (r.hrr2 === null ? [] : [r.hrr2]));
  const hrrMedian = median(hrrValues);
  return {
    n: runs.length,
    withZones: zones.length,
    zoneTotalsSec: totals,
    easyPct: totals === null ? null : pct(totals.z1 + totals.z2, total),
    hardPct: totals === null ? null : pct(totals.z4 + totals.z5, total),
    hrr2: hrrMedian === null ? null : { median: Math.round(hrrMedian), n: hrrValues.length },
    dynamics: summarizeDynamics(runs),
  };
}
