// #295 (M14 Phase 2 #2): 자주 먹는 음식 라이브러리 — description 정규화 후 최근 로그에서
// 같은 key 매치 시 kcal 재사용. AI 호출 절감 + 값 일관성.
//
// 스키마 변경 없음. 최근 N일 pool (최대 500건) 을 fetch 해 in-memory 정규화 비교.
// 단일 사용자 앱이라 pool 크기 부담 없음.

import prisma from "@/lib/prisma";

/** 조회 창 (일). 이보다 오래된 로그는 매치 대상 아님. */
const LOOKUP_WINDOW_DAYS = 30;
/** DB 에서 fetch 할 pool 상한. */
const POOL_CAP = 500;

/**
 * description 정규화 규칙:
 *  - 앞뒤 trim
 *  - 구두점 제거 (,.·—-!?;:)
 *  - 연속 공백 → 단일 공백
 *  - 소문자 (영어 부분만 영향, 한글 무관)
 *  - 토큰 (공백 기준) 정렬 → 순서 무관 매칭
 *  - 정량 표기 (300g, 1인분) 유지 → 다른 양은 다른 kcal 로 취급
 */
export function normalizeDescription(description: string): string {
  const stripped = description
    .toLowerCase()
    .replace(/[,.·—\-!?;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return "";
  const tokens = stripped.split(" ").filter((t) => t.length > 0);
  tokens.sort();
  return tokens.join(" ");
}

export interface RepeatLookupHit {
  logId: string;
  kcal: number;
  date: Date;
  mealType: string | null;
  description: string;
}

/**
 * 최근 N일 내 정규화 key 가 같은 log 검색. estimatedKcal 이 non-null 인 로그만.
 *   - 같은 mealType 있으면 그 중 최신, 없으면 다른 mealType 도 fallback
 *   - 매치 없으면 null
 */
export async function findRecentSameDescription(
  description: string,
  mealType?: string | null,
): Promise<RepeatLookupHit | null> {
  const targetKey = normalizeDescription(description);
  if (!targetKey) return null;

  const since = new Date();
  since.setDate(since.getDate() - LOOKUP_WINDOW_DAYS);

  const pool = await prisma.foodLog.findMany({
    where: {
      date: { gte: since },
      estimatedKcal: { not: null },
    },
    orderBy: { date: "desc" },
    select: {
      id: true,
      description: true,
      mealType: true,
      estimatedKcal: true,
      date: true,
    },
    take: POOL_CAP,
  });

  const sameKey = pool.filter((r) => normalizeDescription(r.description) === targetKey);
  if (sameKey.length === 0) return null;

  // 같은 mealType 우선. 여러 개면 orderBy date desc 이미 적용됨 → 첫 번째가 최신.
  const sameMeal = mealType
    ? sameKey.find((r) => r.mealType === mealType)
    : undefined;
  const chosen = sameMeal ?? sameKey[0];

  // estimatedKcal 은 위 where 절에서 { not: null } 로 보장되지만 TS narrowing.
  if (chosen.estimatedKcal === null) return null;
  return {
    logId: chosen.id,
    kcal: chosen.estimatedKcal,
    date: chosen.date,
    mealType: chosen.mealType,
    description: chosen.description,
  };
}
