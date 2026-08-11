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
// 흔한 한글 counter — 병(맥주/소주), 통(우유/캔), 마리(생선), 그릇(국/밥), 캔(음료).
// Codex P2 (#296): 빠지면 `맥주 한 병 소주 두 병` 이 순서 뒤바뀌어도 같은 key 로 판정되어
// 다른 병 수의 이전 로그 kcal 를 재사용하는 오답.
const QUANTITY_UNITS_LIST = "공기|인분|개|조각|컵|장|봉|스푼|팩|숟가락|접시|잔|모금|알|판|병|통|마리|그릇|캔";
// 한글 수사: atom + compound (열한/열두/스물한 등). Codex P2 (#296).
const KOREAN_NUM_ATOMS = "한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|스물|서른|마흔|쉰|예순|일흔|여든|아흔";
const KOREAN_NUM_ONES = "한|두|세|네|다섯|여섯|일곱|여덟|아홉";
const KOREAN_NUM_TENS = "열|스물|서른|마흔|쉰|예순|일흔|여든|아흔";
const KOREAN_NUMS_LIST = `(?:${KOREAN_NUM_TENS})(?:${KOREAN_NUM_ONES})|${KOREAN_NUM_ATOMS}`;
const QUANTITY_UNITS = new RegExp(`^(?:${QUANTITY_UNITS_LIST})$`);
const KOREAN_NUM_PREFIXED = new RegExp(
  `^(?:${KOREAN_NUMS_LIST})(?:${QUANTITY_UNITS_LIST})$`,
);
// 원본 문자열에서 '한 공기', '열한 공기' 등 space-separated form 을 concatenated 로 변환해
// 이후 pair 로직에 인식되게 함.
const SPACED_KOR_QTY = new RegExp(
  `(?<![가-힣])(${KOREAN_NUMS_LIST})\\s+(${QUANTITY_UNITS_LIST})(?![가-힣])`,
  "g",
);
// Codex P2 (#296): '1 공기', '1.5 인분' 같은 아라비아 숫자 + 공백 + 단위 도 concatenate.
const SPACED_NUM_QTY = new RegExp(
  `(?<!\\S)(\\d+(?:\\.\\d+)?)\\s+(${QUANTITY_UNITS_LIST})(?![가-힣])`,
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
 *  - qty 토큰을 경계로 phrase 분할 — qty 직전까지 누적된 non-qty 토큰들 (modifier + food)
 *    을 함께 phrase 로 묶어, `큰 사과 1개` 같은 modifier 를 food 에서 분리하지 않음.
 *    Codex P2 (#296): 이전엔 두-토큰 pair 로 sort 하다 modifier 가 detach 되어
 *    `큰 사과 1개 작은 바나나 2개` == `큰 바나나 2개 작은 사과 1개` 로 오매칭.
 *  - qty 없는 trailing 토큰들은 개별 phrase 로 sort tolerance 확보 (예: `밥 김치` == `김치 밥`).
 *  - phrase 그룹 단위로만 sort → qty 그룹 순서는 무관, phrase 내부 순서는 보존.
 */
export function normalizeDescription(description: string): string {
  const stripped = description
    .toLowerCase()
    .replace(/[,·!?;:\-]/g, " ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    // Codex P2 (#296): '한 공기' → '한공기', '1 공기' → '1공기' 결합해 quantity token 으로 인식.
    .replace(SPACED_KOR_QTY, "$1$2")
    .replace(SPACED_NUM_QTY, "$1$2")
    .trim();
  if (!stripped) return "";
  const tokens = stripped.split(" ").filter((t) => t.length > 0);
  const phrases: string[] = [];
  // qty 를 만날 때까지 누적된 non-qty 토큰 (modifier + food). qty 만나면 phrase 로 flush.
  let modifiers: string[] = [];
  // 앞선 unclaimed qty (예: `1개 사과`) — 다음 첫 non-qty 토큰과만 pair 해 `사과 1개` 로.
  let leadingQty: string | null = null;
  for (const t of tokens) {
    if (isQuantityToken(t)) {
      if (modifiers.length > 0) {
        phrases.push(`${modifiers.join(" ")} ${t}`);
        modifiers = [];
      } else if (leadingQty !== null) {
        // 연속 qty — 앞선 leadingQty 홀로 push, 이 qty 가 새 leadingQty.
        phrases.push(leadingQty);
        leadingQty = t;
      } else {
        leadingQty = t;
      }
    } else if (leadingQty !== null) {
      // leadingQty 는 첫 non-qty 토큰과만 pair. 그 뒤 토큰은 새 modifier run.
      // (`한컵 우유 3알 달걀` → `우유 한컵` + `달걀 3알`)
      phrases.push(`${t} ${leadingQty}`);
      leadingQty = null;
    } else {
      modifiers.push(t);
    }
  }
  for (const m of modifiers) phrases.push(m);
  if (leadingQty !== null) phrases.push(leadingQty);
  phrases.sort();
  return phrases.join(" ");
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
 *   - Codex P2 (#296): referenceDate 인자로 target 시각 기준 창을 사용 — backdated 로그나
 *     backfill 이 옛 row 처리 시 그 시점 기준 preceding history 만 매치.
 */
export async function findRecentSameDescription(
  description: string,
  mealType?: string | null,
  referenceDate?: Date,
): Promise<RepeatLookupHit | null> {
  const targetKey = normalizeDescription(description);
  if (!targetKey) return null;

  const ref = referenceDate ?? new Date();
  const since = new Date(ref);
  since.setDate(since.getDate() - LOOKUP_WINDOW_DAYS);

  const pool = await prisma.foodLog.findMany({
    where: {
      date: { gte: since, lte: ref },
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
