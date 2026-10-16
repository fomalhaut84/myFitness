// #527: 결과지 원문 (기준범위 · 결과값) 해석. 실패는 에러가 아니라 "원문만 보존" (스펙 §4 P1 · P2). 순수.
import type { CheckupValueType } from "./items";

export interface ParsedReference {
  refText: string | null;
  refLow: number | null;
  refHigh: number | null;
  /** `<b` · `b 미만` (상한 미포함) / `>a` · `a 초과` (하한 미포함) — 판정 경계 (#527 사전 리뷰 major 2). 저장 컬럼 없음 — refText 가 원문 */
  lowExclusive: boolean;
  highExclusive: boolean;
}

export interface ParsedValue {
  valueNum: number | null;
  valueText: string | null;
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const RANGE_RE = new RegExp(String.raw`^${NUM}\s*[-~]\s*${NUM}$`);
const UPPER_RE = new RegExp(String.raw`^(?:([<≤])(=?)\s*${NUM}|${NUM}\s*(이하|미만))$`);
const LOWER_RE = new RegExp(String.raw`^(?:([>≥])(=?)\s*${NUM}|${NUM}\s*(이상|초과)|${NUM}\s*-)$`);
const PLAIN_NUM_RE = /^-?\d+(?:\.\d+)?$/;

function clean(text: string | null | undefined): string | null {
  const t = text?.trim();
  return t ? t : null;
}

const NONE: Omit<ParsedReference, "refText"> = { refLow: null, refHigh: null, lowExclusive: false, highExclusive: false };

/** 해석용 정규화 (원문 refText 는 그대로 저장): 전각 → 반각 · en/em dash → `-` · 숫자 사이 천단위 쉼표 제거 */
function normalizeForParse(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[–—−]/g, "-")
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
}

/**
 * 기준범위 원문 → 하한 · 상한.
 * `a-b` · `a~b` / `≤b` · `<b` · `b 이하` / `≥a` · `>a` · `a 이상` · `a-` / 그 외 (정성 `-,음성` 등) 는 원문만.
 * 하한 > 상한이면 뒤집힌 입력으로 보고 해석하지 않는다.
 */
export function parseReference(text: string | null | undefined): ParsedReference {
  const refText = clean(text);
  if (!refText) return { refText: null, ...NONE };
  const t = normalizeForParse(refText);

  const range = RANGE_RE.exec(t);
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    return low <= high ? { refText, ...NONE, refLow: low, refHigh: high } : { refText, ...NONE };
  }
  const upper = UPPER_RE.exec(t);
  if (upper) {
    // `<` (뒤 `=` 없음) · `미만` 은 상한 미포함
    const exclusive = (upper[1] === "<" && upper[2] === "") || upper[5] === "미만";
    return { refText, ...NONE, refHigh: Number(upper[3] ?? upper[4]), highExclusive: exclusive };
  }
  const lower = LOWER_RE.exec(t);
  if (lower) {
    const exclusive = (lower[1] === ">" && lower[2] === "") || lower[5] === "초과";
    return { refText, ...NONE, refLow: Number(lower[3] ?? lower[4] ?? lower[6]), lowExclusive: exclusive };
  }
  return { refText, ...NONE };
}

/**
 * 결과값 원문 → 수치 · 원문. `valueText` 는 항상 원문 보존.
 * 수치는 numeric 항목의 순수 숫자만 (`0-1` 같은 범위 문자열 · `<0.5` 같은 부등호 값은 원문만).
 */
export function parseResultValue(text: string | null | undefined, valueType: CheckupValueType): ParsedValue {
  const valueText = clean(text);
  if (!valueText) return { valueNum: null, valueText: null };
  if (valueType !== "numeric" || !PLAIN_NUM_RE.test(valueText)) return { valueNum: null, valueText };
  const n = Number(valueText);
  return Number.isFinite(n) ? { valueNum: n, valueText } : { valueNum: null, valueText };
}
