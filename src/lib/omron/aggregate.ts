/**
 * #514: OMRON 측정 → 일별 행 (순수). 날짜는 KST 기준 · KST 자정 instant 로 저장한다.
 */
import { ymdKST } from "@/lib/garmin/utils";
import type { OmronBpReading, OmronScaleReading } from "./parse";

/** Garmin BloodPressure.category 와 같은 값 체계 (MCP 2단계 연속 판정 등이 이 값을 쓴다) */
export type BpCategory = "NORMAL" | "HIGH_NORMAL" | "STAGE_1_HIGH" | "STAGE_2_HIGH";

const CATEGORY_RANK: Record<BpCategory, number> = {
  NORMAL: 0,
  HIGH_NORMAL: 1,
  STAGE_1_HIGH: 2,
  STAGE_2_HIGH: 3,
};

/** 측정 1건 분류 — AHA 2017. 프로덕션 Garmin 행과 대조해 경계 확인 (스펙 §7) */
export function classifyBp(systolic: number, diastolic: number): BpCategory {
  if (systolic >= 140 || diastolic >= 90) return "STAGE_2_HIGH";
  if (systolic >= 130 || diastolic >= 80) return "STAGE_1_HIGH";
  if (systolic >= 120) return "HIGH_NORMAL";
  return "NORMAL";
}

function kstMidnight(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+09:00`);
}

function groupByKstDay<T extends { measuredAt: Date }>(items: readonly T[]): Array<[string, T[]]> {
  const sorted = [...items].sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
  const groups = sorted.reduce<Map<string, T[]>>((acc, item) => {
    const ymd = ymdKST(item.measuredAt);
    return acc.set(ymd, [...(acc.get(ymd) ?? []), item]);
  }, new Map());
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export interface BpMeasurementEntry {
  measuredAt: string; // ISO 8601
  systolic: number;
  diastolic: number;
  pulse: number | null;
  category: BpCategory;
  /** 원본 코드값 (플래그 등 미확정 코드 포함 · 스펙 §2-3) */
  values: Record<string, number>;
}

export interface BpDay {
  ymd: string;
  date: Date;
  highSystolic: number;
  lowSystolic: number;
  highDiastolic: number;
  lowDiastolic: number;
  avgPulse: number | null;
  measureCount: number;
  category: BpCategory;
  measurements: BpMeasurementEntry[];
}

export function aggregateBpByDay(readings: readonly OmronBpReading[]): BpDay[] {
  return groupByKstDay(readings).map(([ymd, day]) => {
    const measurements = day.map((r) => ({
      measuredAt: r.measuredAt.toISOString(),
      systolic: r.systolic,
      diastolic: r.diastolic,
      pulse: r.pulse,
      category: classifyBp(r.systolic, r.diastolic),
      values: r.values,
    }));
    const pulses = day.flatMap((r) => (r.pulse === null ? [] : [r.pulse]));
    const systolics = day.map((r) => r.systolic);
    const diastolics = day.map((r) => r.diastolic);
    return {
      ymd,
      date: kstMidnight(ymd),
      highSystolic: Math.max(...systolics),
      lowSystolic: Math.min(...systolics),
      highDiastolic: Math.max(...diastolics),
      lowDiastolic: Math.min(...diastolics),
      avgPulse: pulses.length > 0 ? Math.round(pulses.reduce((s, p) => s + p, 0) / pulses.length) : null,
      measureCount: day.length,
      // Garmin 과 같이 그날 측정 중 가장 높은 단계 (스펙 §7)
      category: measurements.reduce<BpCategory>(
        (worst, m) => (CATEGORY_RANK[m.category] > CATEGORY_RANK[worst] ? m.category : worst),
        "NORMAL"
      ),
      measurements,
    };
  });
}

export interface ScaleDay {
  ymd: string;
  date: Date;
  /** 그 KST 날짜의 가장 이른 측정 (2026-10-15 사용자 결정) */
  representative: OmronScaleReading;
  /** 그날 전체 측정 · 시간순 (rawData 보존용) */
  all: OmronScaleReading[];
}

export function pickDailyScale(readings: readonly OmronScaleReading[]): ScaleDay[] {
  return groupByKstDay(readings).map(([ymd, day]) => ({
    ymd,
    date: kstMidnight(ymd),
    representative: day[0],
    all: day,
  }));
}
