// #527: 검증된 입력 → 저장 행. 항목 식별 (code · 매칭 · custom) → 값 · 기준범위 해석 → 판정. 순수 (DB 무관).
import { kstInstant } from "@/lib/history/buckets";
import { CUSTOM_PREFIX, getCheckupItem, isCustomCode, OTHER_CATEGORY } from "./items";
import { customCode, lookupNormalized, matchItem } from "./match";
import { parseReference, parseResultValue } from "./parse";
import { resolveFlag, type CheckupFlag, type FlagSource } from "./flag";
import type { CheckupResultInput } from "./schema";

export interface CheckupResultRow {
  itemCode: string;
  label: string;
  category: string;
  valueNum: number | null;
  valueText: string | null;
  unit: string | null;
  refText: string | null;
  refLow: number | null;
  refHigh: number | null;
  flag: CheckupFlag | null;
  flagSource: FlagSource | null;
  note: string | null;
  followUp: string | null;
  followUpDue: Date | null;
}

export type BuildResult = { ok: true; rows: CheckupResultRow[] } | { ok: false; error: string };

const CUSTOM_CODE_RE = /^custom:[0-9a-z가-힣]{1,100}$/; // MAX_CUSTOM_SLUG

function resolveCode(input: CheckupResultInput): { code: string } | { error: string } {
  if (input.itemCode) {
    if (getCheckupItem(input.itemCode)) return { code: input.itemCode };
    if (isCustomCode(input.itemCode) && CUSTOM_CODE_RE.test(input.itemCode)) {
      // `custom:ldl` 처럼 카탈로그 항목과 같은 이름이면 카탈로그 code 로 — 같은 항목이 두 code 로 갈라지지 않게
      const catalog = lookupNormalized(input.itemCode.slice(CUSTOM_PREFIX.length));
      return { code: catalog ?? input.itemCode };
    }
    return { error: `알 수 없는 항목 코드입니다: ${input.itemCode}` };
  }
  const code = matchItem(input.label) ?? customCode(input.label);
  return code ? { code } : { error: `항목명을 알아볼 수 없거나 너무 깁니다: ${input.label}` };
}

function buildRow(input: CheckupResultInput, code: string): CheckupResultRow {
  const item = getCheckupItem(code);
  const { valueNum, valueText } = parseResultValue(input.value, item?.valueType ?? "numeric");
  const { refText, refLow, refHigh, lowExclusive, highExclusive } = parseReference(input.ref);
  const { flag, flagSource } = resolveFlag({ flag: input.flag, valueNum, refLow, refHigh, lowExclusive, highExclusive });
  return {
    itemCode: code,
    label: input.label,
    category: item?.category ?? input.category ?? OTHER_CATEGORY,
    valueNum,
    valueText,
    unit: input.unit ?? item?.unit ?? null,
    refText,
    refLow,
    refHigh,
    flag,
    flagSource,
    note: input.note ?? null,
    followUp: input.followUp ?? null,
    followUpDue: input.followUpDue ? kstInstant(input.followUpDue) : null,
  };
}

/** 같은 항목이 두 번 들어오면 (별칭 · 원문 표기가 달라도) 거부 — 회차 안에서 항목은 하나 (`@@unique([checkupId, itemCode])`). */
export function buildResultRows(inputs: readonly CheckupResultInput[]): BuildResult {
  const rows: CheckupResultRow[] = [];
  const seen = new Map<string, string>();
  for (const input of inputs) {
    const resolved = resolveCode(input);
    if ("error" in resolved) return { ok: false, error: resolved.error };
    const prevLabel = seen.get(resolved.code);
    if (prevLabel !== undefined) {
      return { ok: false, error: `같은 항목이 두 번 입력됐습니다: ${prevLabel} · ${input.label}` };
    }
    seen.set(resolved.code, input.label);
    rows.push(buildRow(input, resolved.code));
  }
  return { ok: true, rows };
}
