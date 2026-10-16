// #527: 결과지 항목명 → 카탈로그 code. 기관 · 연도마다 표기가 달라 (괄호 부기 · `_` 결합 · 대소문자 · 그리스 문자)
// 정규화 + 후보 분해로 맞춘다. 기관별 표기를 별칭으로 하드코딩하지 않는다 (public 저장소 · 스펙 §5). 순수.
import { CHECKUP_ITEMS, CUSTOM_PREFIX } from "./items";

/** custom code slug 상한 — 자르지 않는다 (앞부분이 같은 두 이름이 한 code 로 합쳐진다 · PR #528 Codex P2). 넘으면 null */
export const MAX_CUSTOM_SLUG = 100;

/** 비교용 정규화: NFKC · 소문자 · γ→g · 공백 · 구두점 제거. 한글 · 영숫자만 남긴다. */
export function normalizeLabel(label: string): string {
  return label
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[γɣ]/g, "g")
    .replace(/[^0-9a-z가-힣]/g, "");
}

const INDEX: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const item of CHECKUP_ITEMS) {
    for (const name of [item.code, item.label, ...item.aliases]) {
      const key = normalizeLabel(name);
      if (key && !map.has(key)) map.set(key, item.code);
    }
  }
  return map;
})();

/**
 * 검체 · 조건 한정자 — 괄호 부기나 `_` 부분이 이것이면 떼어 낸 이름이 **다른 검체의 항목**이 된다
 * (`WBC(요)` → 혈액 WBC · `혈당(식후)` → 공복혈당). 이 경우 전체 이름 일치만 믿는다 (#527 사전 리뷰 major 1).
 */
const QUALIFIER_RE = /^(요|뇨|소변|요침사|urine|분변|대변|stool|객담|csf|뇌척수액|식후.*|pp\d*.*|24시간.*|random|수시)$/;

/**
 * 부분 문자열로 찾는 검체 · 조건 키워드 — 앞뒤에 무엇이 붙어도 (`urinesediment` · `검체소변` · `식후2시간`) 한정자.
 * `검체` · `specimen` · `sample` 은 검체를 따로 명시했다는 뜻이라 그 자체로 가드 (PR #528 Codex P1 2회차).
 * 한 글자 `요` · `뇨` 는 부분 문자열로 찾지 않는다 (`요산` 등 오탐) — 구분자로 나뉜 토큰일 때만 (QUALIFIER_RE).
 */
const QUALIFIER_KEYWORD_RE = /(urine|소변|요침사|분변|대변|stool|객담|뇌척수액|식후|24시간|검체|specimen|sample)/;

/**
 * 괄호 부기 · `_` 부분에 검체 · 조건 한정자가 있으면 true.
 * 토큰은 영숫자 · 한글이 아닌 모든 문자 (`,` `/` `:` `-` `=` 공백 …) 로 나눈다 —
 * `WBC(요, 정성)` · `WBC(Urine sediment)` · `WBC(검체:요)` · `RBC(검체-소변)` (PR #528 Codex P1 1 · 2회차).
 */
function hasQualifier(label: string): boolean {
  const inner = [...label.matchAll(/[([]([^)\]]*)[)\]]/g)].map((m) => m[1]);
  const parts = label.includes("_") ? label.split("_") : [];
  return [...inner, ...parts].some((segment) => {
    const whole = normalizeLabel(segment);
    if (QUALIFIER_RE.test(whole) || QUALIFIER_KEYWORD_RE.test(whole)) return true;
    return segment
      .normalize("NFKC")
      .split(/[^0-9A-Za-z가-힣]+/)
      .some((token) => QUALIFIER_RE.test(normalizeLabel(token)));
  });
}

/**
 * 원문 항목명의 비교 후보 (우선순위 순):
 * 전체 → 괄호 · 대괄호 부기 제거 → 괄호 안 내용 → `_` 로 나눈 각 부분 (뒤에서부터 — 보통 약어가 뒤) 과 그 부기 제거형.
 * 검체 · 조건 한정자가 있으면 전체 이름만.
 */
export function labelCandidates(label: string): string[] {
  if (hasQualifier(label)) {
    const whole = normalizeLabel(label);
    return whole ? [whole] : [];
  }
  const stripped = label.replace(/[([][^)\]]*[)\]]/g, " ");
  const inner = [...label.matchAll(/[([]([^)\]]*)[)\]]/g)].map((m) => m[1]);
  const parts = label.includes("_") ? label.split("_").reverse() : [];
  const partStripped = parts.map((p) => p.replace(/[([][^)\]]*[)\]]/g, " "));
  const all = [label, stripped, ...inner, ...parts, ...partStripped].map(normalizeLabel).filter(Boolean);
  return [...new Set(all)];
}

/** 카탈로그 code 또는 null (미매칭). */
export function matchItem(label: string): string | null {
  for (const key of labelCandidates(label)) {
    const code = INDEX.get(key);
    if (code) return code;
  }
  return null;
}

/** 정규화된 이름 → 카탈로그 code (custom slug 가 카탈로그 항목과 겹치는지 확인용). */
export function lookupNormalized(key: string): string | null {
  return INDEX.get(key) ?? null;
}

/** 카탈로그 밖 항목 code — 같은 이름은 회차 간 같은 code 로 묶인다. 정규화 결과가 비거나 상한을 넘으면 null. */
export function customCode(label: string): string | null {
  const slug = normalizeLabel(label);
  return slug && slug.length <= MAX_CUSTOM_SLUG ? `${CUSTOM_PREFIX}${slug}` : null;
}
