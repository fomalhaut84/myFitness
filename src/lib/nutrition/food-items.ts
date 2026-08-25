// #322 (M14 Phase 3 #2): FoodLog.items breakdown 공통 타입 · 파싱 · 스케일 헬퍼.
// - client component (NutritionFoodList) 와 server component (nutrition/page) 양쪽 import 되므로
//   "use client" 파일에 두면 boundary 오염 위험 (사전 리뷰 P0). 순수 헬퍼 파일로 분리.
// - JSONB read 는 sanitize 필수 (legacy null · malformed) — 저장은 estimator 산출값 신뢰.

export interface FoodItemBreakdown {
  name: string;
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

/**
 * DB JSON → FoodItemBreakdown[] 안전 파싱. shape 어긋나면 null (UI 는 토글 숨김).
 * 엄격 all-or-nothing: 하나라도 name 없으면 전체 reject → 부분 표시로 오해 방지.
 */
export function sanitizeFoodItemBreakdown(raw: unknown): FoodItemBreakdown[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: FoodItemBreakdown[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") return null;
    const r = it as Record<string, unknown>;
    if (typeof r.name !== "string" || !r.name) return null;
    const numOrNull = (v: unknown): number | null =>
      v === null || v === undefined
        ? null
        : typeof v === "number" && Number.isFinite(v)
          ? v
          : null;
    out.push({
      name: r.name,
      kcal: numOrNull(r.kcal),
      proteinG: numOrNull(r.proteinG),
      carbsG: numOrNull(r.carbsG),
      fatG: numOrNull(r.fatG),
    });
  }
  return out;
}

/**
 * #322 사전 리뷰 P1: hit.kcal / retainedKcal 로 top-level macros 는 스케일하면서 items 는
 * estimator 원본 그대로 저장 → items 합계 (예: 550) ≠ top-level kcal (예: 400) 로 UI 표시가
 * 어긋남. items 도 같은 비율로 스케일해 정합화.
 *
 * @param targetKcal — 최종 저장할 top-level kcal
 * @param sourceKcal — estimator (items 산출 시점) total kcal
 * @param items — estimator 원본 items
 * @returns 스케일된 items. targetKcal/sourceKcal 유효하지 않으면 items 원본 그대로.
 */
export function scaleItemsForNewKcal(
  targetKcal: number | null,
  sourceKcal: number | null,
  items: FoodItemBreakdown[] | null | undefined,
): FoodItemBreakdown[] | null {
  if (!items || items.length === 0) return null;
  if (
    targetKcal === null ||
    sourceKcal === null ||
    sourceKcal <= 0 ||
    targetKcal === sourceKcal
  ) {
    return items;
  }
  const ratio = targetKcal / sourceKcal;
  const scale1 = (v: number | null): number | null =>
    v === null ? null : Math.round(v * ratio * 10) / 10;
  return items.map((it) => ({
    name: it.name,
    kcal: it.kcal === null ? null : Math.round(it.kcal * ratio),
    proteinG: scale1(it.proteinG),
    carbsG: scale1(it.carbsG),
    fatG: scale1(it.fatG),
  }));
}
