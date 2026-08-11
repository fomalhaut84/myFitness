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
 * quantity token 판정: 숫자로 시작 (300g, 1공기, 1.5인분), 순수 한글 수량 단위, 또는
 * 한글 수사 + 단위 결합 (한공기/두접시). Codex P2 (#296).
 */
const QUANTITY_UNITS_LIST = "공기|인분|개|조각|컵|장|봉|스푼|팩|숟가락|접시|잔|모금|알|판";
const KOREAN_NUMS_LIST = "한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|서른|마흔";
const QUANTITY_UNITS = new RegExp(`^(?:${QUANTITY_UNITS_LIST})$`);
const KOREAN_NUM_PREFIXED = new RegExp(
  `^(?:${KOREAN_NUMS_LIST})(?:${QUANTITY_UNITS_LIST})$`,
);
// 원본 문자열에서 '한 공기' 등 space-separated form 을 concatenated 로 변환해 이후 pair 로직에
// 인식되게 함. (예: '밥 한 공기' → '밥 한공기').
const SPACED_KOR_QTY = new RegExp(
  `(?<![가-힣])(${KOREAN_NUMS_LIST})\\s+(${QUANTITY_UNITS_LIST})(?![가-힣])`,
  "g",
);

function isQuantityToken(token: string): boolean {
  if (!token) return false;
  if (/^[\d.]/.test(token)) return true;
  if (QUANTITY_UNITS.test(token)) return true;
  if (KOREAN_NUM_PREFIXED.test(token)) return true;
  return false;
}

/**
 * description 정규화 규칙:
 *  - 앞뒤 trim / 소문자 (영어만 영향, 한글 무관)
 *  - 구두점 → 공백 (마침표는 숫자 사이만 유지 예: 1.5)
 *  - (food, quantity?) pair 로 묶어 정렬 → 순서 무관 매칭 + 양-food 연관 보존
 *  - 정량 표기 (300g, 1인분) 는 pair 로 유지되어 다른 양은 다른 key
 */
export function normalizeDescription(description: string): string {
  const stripped = description
    .toLowerCase()
    .replace(/[,·!?;:\-]/g, " ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    // Codex P2 (#296): '한 공기' → '한공기' 결합해 quantity token 으로 인식.
    .replace(SPACED_KOR_QTY, "$1$2")
    .trim();
  if (!stripped) return "";
  const tokens = stripped.split(" ").filter((t) => t.length > 0);
  const pairs: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const cur = tokens[i];
    const next = tokens[i + 1];
    // quantity 가 앞에 오는 경우 (예: '1.5인분 파스타') 도 뒤 food 와 pair — food 를 first
    // 로 정규화해 순서 무관 매칭.
    if (isQuantityToken(cur) && next && !isQuantityToken(next)) {
      pairs.push(`${next} ${cur}`);
      i++;
      continue;
    }
    if (isQuantityToken(cur)) {
      // 예외 (연속 quantity 등) — 그대로.
      pairs.push(cur);
      continue;
    }
    if (next && isQuantityToken(next)) {
      pairs.push(`${cur} ${next}`);
      i++;
    } else {
      pairs.push(cur);
    }
  }
  pairs.sort();
  return pairs.join(" ");
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
 *   - Codex P2 (#296): 미래 날짜 로그 배제 위해 date lte(now) 상한 추가.
 */
export async function findRecentSameDescription(
  description: string,
  mealType?: string | null,
): Promise<RepeatLookupHit | null> {
  const targetKey = normalizeDescription(description);
  if (!targetKey) return null;

  const now = new Date();
  const since = new Date();
  since.setDate(since.getDate() - LOOKUP_WINDOW_DAYS);

  const pool = await prisma.foodLog.findMany({
    where: {
      date: { gte: since, lte: now },
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

  const sameMeal = mealType
    ? sameKey.find((r) => r.mealType === mealType)
    : undefined;
  const chosen = sameMeal ?? sameKey[0];

  if (chosen.estimatedKcal === null) return null;
  return {
    logId: chosen.id,
    kcal: chosen.estimatedKcal,
    date: chosen.date,
    mealType: chosen.mealType,
    description: chosen.description,
  };
}
