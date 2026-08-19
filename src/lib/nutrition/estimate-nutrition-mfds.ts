// #315 (M14 Phase 2 #4): 오픈식약처 기반 nutrition estimator.
// - description → AI 검색어 추출 → 각 item MFDS 조회 → 100g 당 값을 quantityG 로 scale
//   → NutritionEstimate 반환 (텍스트 estimator 와 동일 shape).
// - 통합 flow: repeat-lookup miss → MFDS estimator → miss → AI text estimator (기존).

import { extractFoodQuery, type FoodQueryItem } from "./extract-food-query";
import { fetchMfdsFood, type MfdsHit } from "./food-db-mfds";
import type {
  NutritionEstimate,
  NutritionEstimateInput,
  NutritionItem,
} from "./estimate-nutrition";

// Codex P2 (PR #316 4회차): 텍스트 estimator (parseNutritionResponse) 와 동일 sanity 유지.
// MFDS 는 quantityG 최대 2kg / item * N 로 큰 total 가능 (예: 기름 2kg = 18,000 kcal 저장 위험).
const MAX_KCAL_SANITY = 5000;
const MAX_ITEM_KCAL = 3000;

export interface EstimateMfdsOptions {
  /** 각 API 호출 timeout (default 10s). extract-food-query 는 별도 timeout. */
  fetchTimeoutMs?: number;
  /** 테스트용 fetch 주입 */
  fetchImpl?: typeof fetch;
}

interface ScaledItem {
  name: string;
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

/** 100g 기준 hit 을 quantityG 로 scale. 각 macro 는 null propagate. */
function scaleFromHit(hit: MfdsHit, quantityG: number): ScaledItem {
  const ratio = quantityG / 100;
  const scale1 = (v: number | null): number | null =>
    v === null ? null : Math.round(v * ratio * 10) / 10;
  return {
    name: hit.name,
    kcal: Math.round(hit.kcalPer100g * ratio),
    proteinG: scale1(hit.proteinPer100g),
    carbsG: scale1(hit.carbsPer100g),
    fatG: scale1(hit.fatPer100g),
  };
}

/**
 * MFDS estimator.
 * - 모든 item MFDS hit + kcal 확보 시 total 반환. 일부 miss 는 total 계산 불가로 null 반환
 *   → caller (AI text estimator) 폴백. 이번 스코프에서는 "all-or-nothing" 로 단순화 (부분
 *   MFDS hit + 부분 AI 병합은 소스 혼합 정합성 이슈 · #299 tupleFromSource 정책 유지).
 * - AI 검색어 추출 실패 → null.
 */
export async function estimateNutritionFromMfds(
  input: NutritionEstimateInput,
  opts: EstimateMfdsOptions = {},
): Promise<NutritionEstimate | null> {
  const description = input.description?.trim();
  if (!description) return null;

  // Codex P1 (feat/315-1 2회차): MFDS_API_KEY 없으면 extractFoodQuery (Claude CLI 18s) 낭비.
  // 조기 return → caller (AI text estimator) 폴백. API 키가 문서상 optional 이므로 이 경로도
  // 흔한 시나리오.
  if (!process.env.MFDS_API_KEY) return null;

  // 1) 검색어 추출.
  const queryItems = await extractFoodQuery({
    description,
    mealType: input.mealType,
  });
  if (!queryItems || queryItems.length === 0) return null;

  // 2) 각 item MFDS 조회 (병렬, cache 우선). 하나라도 miss 면 null (all-or-nothing).
  const hits = await Promise.all(
    queryItems.map(async (qi: FoodQueryItem) => {
      const hit = await fetchMfdsFood(qi.query, {
        timeoutMs: opts.fetchTimeoutMs,
        fetchImpl: opts.fetchImpl,
      });
      return hit ? scaleFromHit(hit, qi.quantityG) : null;
    }),
  );
  if (hits.some((h) => h === null)) return null;
  const scaled = hits as ScaledItem[];

  // 3) NutritionEstimate 조립. 텍스트 estimator 와 동일한 total/allNonNull propagate 규칙.
  const items: NutritionItem[] = scaled.map((s) => ({
    name: s.name,
    kcal: s.kcal,
    proteinG: s.proteinG,
    carbsG: s.carbsG,
    fatG: s.fatG,
  }));
  // Codex P2 (PR #316 4회차): item 별 · total sanity 검증. MFDS 는 quantityG 2kg × N item 로
  // 큰 값 가능 → 텍스트 estimator MAX_KCAL_SANITY (5000) / MAX_ITEM_KCAL (3000) 동일 적용.
  // 실패 시 null → caller (AI text estimator) 폴백.
  if (items.some((it) => it.kcal !== null && (it.kcal < 0 || it.kcal > MAX_ITEM_KCAL))) {
    console.warn(
      `[nutrition-mfds] item kcal sanity 초과 (>${MAX_ITEM_KCAL}) — 폴백`,
    );
    return null;
  }
  const totalKcal = items.reduce((acc, it) => acc + (it.kcal ?? 0), 0);
  if (totalKcal < 0 || totalKcal > MAX_KCAL_SANITY) {
    console.warn(
      `[nutrition-mfds] total kcal sanity 초과 (${totalKcal} > ${MAX_KCAL_SANITY}) — 폴백`,
    );
    return null;
  }
  const allP = items.every((it) => it.proteinG !== null);
  const allC = items.every((it) => it.carbsG !== null);
  const allF = items.every((it) => it.fatG !== null);
  const sumP = allP
    ? Math.round(items.reduce((acc, it) => acc + (it.proteinG ?? 0), 0) * 10) / 10
    : null;
  const sumC = allC
    ? Math.round(items.reduce((acc, it) => acc + (it.carbsG ?? 0), 0) * 10) / 10
    : null;
  const sumF = allF
    ? Math.round(items.reduce((acc, it) => acc + (it.fatG ?? 0), 0) * 10) / 10
    : null;

  return {
    kcal: totalKcal,
    proteinG: sumP,
    carbsG: sumC,
    fatG: sumF,
    confidence: "high",   // MFDS 표준 데이터 기반이라 텍스트 AI 추정보다 신뢰도 높음.
    items,
    notes: `오픈식약처 DB (${items.length}개 항목 매치)`,
  };
}
