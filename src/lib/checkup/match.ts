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
 * 원문 항목명의 비교 후보 (우선순위 순):
 * 전체 → 괄호 · 대괄호 부기 제거 → 괄호 안 내용 → `_` 로 나눈 각 부분 (뒤에서부터 — 보통 약어가 뒤) 과 그 부기 제거형.
 */
export function labelCandidates(label: string): string[] {
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

/** 카탈로그 밖 항목 code — 같은 이름은 회차 간 같은 code 로 묶인다. 정규화 결과가 비면 null. */
export function customCode(label: string): string | null {
  const slug = normalizeLabel(label).slice(0, MAX_CUSTOM_SLUG);
  return slug ? `${CUSTOM_PREFIX}${slug}` : null;
}
