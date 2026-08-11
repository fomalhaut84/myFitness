// #299 (M14 Phase 2 #3): 일별 매크로 (P/C/F g) 집계.
// FoodLog 를 KST 하루 창으로 sum. null 은 propagate (kcal 방식과 동일) — 부분 미측정 노출.
// DailySummary 확장은 보류 (초기 스코프 최소화). 파생 함수로만 노출.
//
// 사용처: /nutrition 페이지 · AI 리포트 컨텍스트 · muscle-loss-risk 입력.

import prisma from "@/lib/prisma";
import { ymdKST } from "@/lib/garmin/utils";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface DailyMacros {
  /** YYYY-MM-DD (KST) */
  date: string;
  kcal: number | null;      // 하나라도 null 이면 null.
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  itemCount: number;         // 이 날 저장된 FoodLog row 개수.
  missingCount: number;      // 매크로 · kcal 중 하나라도 null 인 row 개수.
}

function kstDayRange(referenceDate: Date): { start: Date; end: Date; ymd: string } {
  const ymd = ymdKST(referenceDate);
  const [y, m, d] = ymd.split("-").map(Number);
  const kstMidnightUTC = Date.UTC(y, m - 1, d) - KST_OFFSET_MS;
  return {
    start: new Date(kstMidnightUTC),
    end: new Date(kstMidnightUTC + 24 * 60 * 60 * 1000),
    ymd,
  };
}

/** 특정 일자 (KST) 의 매크로 합계. null 필드는 propagate. */
export async function aggregateDailyMacros(referenceDate: Date): Promise<DailyMacros> {
  const { start, end, ymd } = kstDayRange(referenceDate);
  const rows = await prisma.foodLog.findMany({
    where: { date: { gte: start, lt: end } },
    select: { estimatedKcal: true, proteinG: true, carbsG: true, fatG: true },
  });
  let kcal: number | null = 0;
  let p: number | null = 0;
  let c: number | null = 0;
  let f: number | null = 0;
  let missing = 0;
  for (const r of rows) {
    if (r.estimatedKcal === null) {
      kcal = null;
      missing++;
    } else if (kcal !== null) {
      kcal += r.estimatedKcal;
    }
    if (r.proteinG === null) p = null;
    else if (p !== null) p += r.proteinG;
    if (r.carbsG === null) c = null;
    else if (c !== null) c += r.carbsG;
    if (r.fatG === null) f = null;
    else if (f !== null) f += r.fatG;
    // missing: any null field counts once.
    if (
      r.estimatedKcal === null ||
      r.proteinG === null ||
      r.carbsG === null ||
      r.fatG === null
    ) {
      // (already counted kcal null above, but macro-only missing 도 반영)
      if (r.estimatedKcal !== null) missing++;
    }
  }
  const round1 = (n: number | null): number | null =>
    n === null ? null : Math.round(n * 10) / 10;
  return {
    date: ymd,
    kcal: kcal === null ? null : Math.round(kcal),
    proteinG: round1(p),
    carbsG: round1(c),
    fatG: round1(f),
    itemCount: rows.length,
    missingCount: missing,
  };
}

/** 최근 N일 (오늘 포함) 을 하루씩 집계. 오래된 → 최근 순. */
export async function aggregateRecentMacros(
  today: Date,
  days: number,
): Promise<DailyMacros[]> {
  const out: DailyMacros[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push(await aggregateDailyMacros(d));
  }
  return out;
}

/**
 * 7일 평균 (매크로 데이터 있는 날만). null 반환 조건: 유효 데이터가 없는 필드.
 * 러너 근손실 평가에 쓰이므로 partial average 는 표시하되 caller 가 신뢰도 판단.
 */
export interface MacroAverage {
  avgKcal: number | null;
  avgProteinG: number | null;
  avgCarbsG: number | null;
  avgFatG: number | null;
  daysWithProtein: number;
  totalDays: number;
}

export function averageMacros(days: DailyMacros[]): MacroAverage {
  const valid = <T>(pick: (d: DailyMacros) => T | null): { sum: number; count: number } => {
    let sum = 0, count = 0;
    for (const d of days) {
      const v = pick(d) as number | null;
      if (v !== null) { sum += v; count++; }
    }
    return { sum, count };
  };
  const k = valid((d) => d.kcal);
  const p = valid((d) => d.proteinG);
  const c = valid((d) => d.carbsG);
  const f = valid((d) => d.fatG);
  const round1 = (v: number): number => Math.round(v * 10) / 10;
  return {
    avgKcal: k.count > 0 ? Math.round(k.sum / k.count) : null,
    avgProteinG: p.count > 0 ? round1(p.sum / p.count) : null,
    avgCarbsG: c.count > 0 ? round1(c.sum / c.count) : null,
    avgFatG: f.count > 0 ? round1(f.sum / f.count) : null,
    daysWithProtein: p.count,
    totalDays: days.length,
  };
}
