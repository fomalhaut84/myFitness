// #527: 결과지 항목명 → 카탈로그 code. 기관 · 연도마다 표기가 달라 (괄호 부기 · `_` 결합 · 대소문자 · 그리스 문자)
// 정규화 + 후보 분해로 맞춘다. 기관별 표기를 별칭으로 하드코딩하지 않는다 (public 저장소 · 스펙 §5). 순수.
import { CHECKUP_ITEMS, CUSTOM_PREFIX } from "./items";

const MAX_CUSTOM_SLUG = 60;

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

/** 한정자 뒤에 설명이 붙은 형태 (`urinesediment` · `요침사현미경` · `식후2시간`) — 접두로 판정 */
const QUALIFIER_PREFIX_RE = /^(urine|소변|요침사|분변|대변|stool|객담|뇌척수액|식후|24시간)/;

/**
 * 괄호 부기 · `_` 부분을 쉼표 · 슬래시 · 공백으로 다시 나눈 토큰 중 하나라도 한정자면 true.
 * `WBC(요, 정성)` · `WBC(Urine sediment)` 처럼 한정자에 설명이 덧붙은 표기 (PR #528 Codex P1).
 */
function hasQualifier(label: string): boolean {
  const inner = [...label.matchAll(/[([]([^)\]]*)[)\]]/g)].map((m) => m[1]);
  const parts = label.includes("_") ? label.split("_") : [];
  return [...inner, ...parts].some((segment) => {
    const whole = normalizeLabel(segment);
    if (QUALIFIER_RE.test(whole) || QUALIFIER_PREFIX_RE.test(whole)) return true;
    return segment.split(/[,/·;\s]+/).some((token) => QUALIFIER_RE.test(normalizeLabel(token)));
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

/** 카탈로그 밖 항목 code — 같은 이름은 회차 간 같은 code 로 묶인다. 정규화 결과가 비면 null. */
export function customCode(label: string): string | null {
  const slug = normalizeLabel(label).slice(0, MAX_CUSTOM_SLUG);
  return slug ? `${CUSTOM_PREFIX}${slug}` : null;
}
