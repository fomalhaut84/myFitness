// #547 (M18-4): 건강 기록 MCP 응답 조립 — 순수 (DB 무관 · 테스트 대상). 조회는 health-records.ts.
import { getCheckupItem, isCustomCode } from "@/lib/checkup/items";
import { customCode, matchItem, normalizeLabel } from "@/lib/checkup/match";
import { FLAG_LABEL, flagTone } from "@/lib/checkup/view";
import type { MedicationDto } from "@/lib/medication/dto";
import { KIND_LABEL, REGIMEN_LABEL } from "@/lib/medication/dto";
import { courseDays, medicationStatus, sinceText } from "@/lib/medication/period";

export const DEFAULT_ROUNDS = 5;
export const MAX_ROUNDS = 20;
const ITEM_CODE_RE = /^(?:[a-z0-9_]{1,40}|custom:[0-9a-z가-힣]{1,100})$/;

/** 판정 표기 — "주의/이상/정상 (기관 판정 | 범위 계산)" · 판정 없음은 null. 정상도 출처를 붙인다 (PR #548 Codex P2) */
export function flagText(flag: string | null, flagSource: string | null): string | null {
  const tone = flagTone(flag);
  const label = tone ? FLAG_LABEL[tone] : flag === "normal" ? "정상" : null;
  if (!label) return null;
  return `${label} (${flagSource === "computed" ? "범위 계산" : "기관 판정"})`;
}

export function resultValue(r: { valueText: string | null; valueNum: number | null; unit: string | null }): string {
  const v = r.valueText ?? (r.valueNum !== null ? String(r.valueNum) : "");
  return r.unit ? `${v} ${r.unit}` : v;
}

export type ItemQuery = { code: string } | { error: string; suggestions: string[] };

/**
 * item 인자 → 항목 code. code 형식이면 그대로 · `custom:…` 은 slug 를 정규화 · 이름은 카탈로그 매칭 → 카탈로그 밖 이름은
 * custom code (있는지는 호출자가 DB 로 · 없으면 suggestItems).
 */
export function resolveItemQuery(item: string): ItemQuery {
  const q = item.trim();
  if (!q) return { error: "항목을 지정하세요 (예: LDL · 공복혈당 · ldl)", suggestions: [] };
  if (ITEM_CODE_RE.test(q) && (getCheckupItem(q) || isCustomCode(q))) return { code: q };
  // `custom:LDL` 처럼 대문자 · 기호가 섞인 code — slug 만 정규화 (`custom:customldl` 이 되지 않게 · #547 사전 리뷰 info 1)
  const code = isCustomCode(q) ? customCode(q.slice("custom:".length)) : (matchItem(q) ?? customCode(q));
  if (code) return { code };
  return { error: `항목 이름을 알아볼 수 없습니다: ${q}`, suggestions: [] };
}

const MIN_REVERSE_MATCH = 3;

/**
 * 기록이 있는 항목 중 이름이 겹치는 것 (최대 5 · "이름 (code)"). 카탈로그 밖 항목도 포함 — 원문 전체가 code 라
 * 일부 이름으로는 찾을 수 없다 (#547 사전 리뷰 major). 짧은 별칭 (pH 등) 은 질의가 별칭을 품는 쪽으로 매칭하지 않는다.
 */
export function suggestItems(q: string, recorded: readonly { code: string; label: string }[]): string[] {
  const key = normalizeLabel(q);
  if (!key) return [];
  const matches = (name: string) => {
    const n = normalizeLabel(name);
    return n !== "" && (n.includes(key) || (n.length >= MIN_REVERSE_MATCH && key.includes(n)));
  };
  return recorded
    .filter((r) => {
      const item = getCheckupItem(r.code);
      return [r.label, ...(item ? [item.label, ...item.aliases] : [])].some(matches);
    })
    .slice(0, 5)
    .map((r) => `${r.label} (${r.code})`);
}

export interface MedicationView {
  name: string;
  kind: string;
  regimen: string;
  status: "복용 중" | "종료" | "시작 전";
  period: string;
  dose: string | null;
  frequency: string | null;
  ingredient: string | null;
  purpose: string | null;
  relatedCheckupItems: string[];
}

export function medicationView(med: MedicationDto, todayYmd: string, customLabels: Readonly<Record<string, string>>): MedicationView {
  const status = medicationStatus(med, todayYmd);
  const range = `${med.startDate} ~ ${med.endDate ?? ""}`.trim();
  const period =
    status === "active" && med.regimen === "long_term" && med.endDate === null
      ? `${med.startDate} 부터 복용 중 (${sinceText(med.startDate, todayYmd)})`
      : med.endDate
        ? `${range} (${courseDays(med.startDate, med.endDate)}일)`
        : range;
  return {
    name: med.name,
    kind: KIND_LABEL[med.kind],
    regimen: REGIMEN_LABEL[med.regimen],
    status: status === "active" ? "복용 중" : status === "ended" ? "종료" : "시작 전",
    period,
    dose: med.dose,
    frequency: med.frequency,
    ingredient: med.ingredient,
    purpose: med.purpose,
    relatedCheckupItems: med.relatedItems.map((c) => getCheckupItem(c)?.label ?? customLabels[c] ?? c.replace(/^custom:/, "")),
  };
}
