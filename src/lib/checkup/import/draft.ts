// #532: 병합된 추출 결과 → 확인 화면 초안 (회차별 행 + 항목 매칭). 금회 행 → 금회 회차, 과거결과 열 → 날짜별 회차. 순수.
import { getCheckupItem } from "../items";
import { customCode, lookupNormalized, matchItem, normalizeLabel } from "../match";
import type { CheckupFlag } from "../flag";
import { pastKey, type MergedExtraction, type MergedItem } from "./merge";

/** exact: 원문 이름이 카탈로그 이름 · 별칭과 그대로 일치 / fuzzy: 부기 제거 · 분해로 찾음 (확인 필요) / none: 카탈로그 밖 (새 항목) */
export type MatchConfidence = "exact" | "fuzzy" | "none";

export interface ItemMatch {
  /** null: 이름으로 항목을 만들 수 없다 (기호만 · 너무 김) — 포함할 수 없음 */
  itemCode: string | null;
  confidence: MatchConfidence;
}

export interface DraftRow {
  key: string;
  label: string;
  section: string | null;
  value: string;
  unit: string | null;
  ref: string | null;
  flag: CheckupFlag | null;
  note: string | null;
  followUp: string | null;
  followUpDue: string | null;
  itemCode: string | null;
  confidence: MatchConfidence;
  /** 같은 행이 쪽마다 다른 값으로 읽혔다 */
  conflict: boolean;
  include: boolean;
  /** 같은 날짜 회차에 같은 항목이 있고 값이 다를 때만 의미 — 체크한 것만 덮어쓴다 (스펙 §3-2) */
  overwrite: boolean;
  /**
   * 사용자가 포함을 바꾸거나 덮어쓰기를 체크한 때의 회차 날짜 — 그 날짜의 기존 회차 기본값이 늦게 와도 덮지 않는다 (#533).
   * 날짜가 바뀌면 무효 — A 회차에서 체크한 덮어쓰기가 B 회차 값을 덮지 않게 (#533 사전 리뷰 major). null = 직접 바꾼 적 없음
   */
  touchedFor: string | null;
}

export interface DraftRound {
  /** "current" · 과거 회차 날짜 · 날짜 미확인 회차는 "?<원문 표기>" */
  key: string;
  current: boolean;
  /** 금회 · 날짜 미확인 과거 회차는 사용자 입력 전 null */
  date: string | null;
  /** 과거결과 열에서 날짜를 못 읽은 회차 — 결과지의 날짜 표기 원문 (사용자가 보고 날짜를 넣는다) */
  dateText: string | null;
  /** 과거결과 열에서 날짜를 못 읽어 사용자가 날짜를 확인해야 하는 회차 */
  needsDate: boolean;
  rows: DraftRow[];
}

/** 소변 섹션 · 요침사 섹션 — 혈액 항목과 이름이 같은 행 (WBC · RBC) 을 소변 항목으로 다시 찾는다 */
const URINE_SECTION_RE = /(소변|요검사|뇨검사|요화학|urine|urinalysis)/;
const SEDIMENT_SECTION_RE = /(요침사|sediment)/;

function urineQualifier(section: string | null): string | null {
  const s = normalizeLabel(section ?? "");
  if (SEDIMENT_SECTION_RE.test(s)) return "요침사";
  if (URINE_SECTION_RE.test(s)) return "요";
  return null;
}

/** 카탈로그 밖 항목 code. 이름이 카탈로그 항목과 같아지면 (`custom:wbc` → wbc) 섹션을 붙여 구분, 그래도 겹치면 null */
export function newItemCode(label: string, section: string | null): string | null {
  for (const name of [label, `${section ?? ""}${label}`]) {
    const code = customCode(name);
    if (code && !lookupNormalized(code.slice("custom:".length))) return code;
  }
  return null;
}

export function matchExtracted(label: string, section: string | null): ItemMatch {
  const code = matchItem(label);
  const qualifier = urineQualifier(section);
  if (!code) {
    // 소변 섹션의 `빌리루빈` 처럼 이름만으론 없지만 한정자를 붙이면 소변 항목인 경우
    const urine = qualifier ? matchItem(`${label}(${qualifier})`) : null;
    if (urine && getCheckupItem(urine)?.category === "소변") return { itemCode: urine, confidence: "fuzzy" };
    return { itemCode: newItemCode(label, section), confidence: "none" };
  }
  if (qualifier && getCheckupItem(code)?.category !== "소변") {
    // 소변 섹션의 `WBC` 가 혈액 백혈구로 가지 않게 — 한정자를 붙여 다시 찾고, 못 찾으면 그대로 두되 확인 표시
    const urine = matchItem(`${label}(${qualifier})`);
    const urineCode = urine && getCheckupItem(urine)?.category === "소변" ? urine : null;
    return { itemCode: urineCode ?? code, confidence: "fuzzy" };
  }
  const exact = lookupNormalized(normalizeLabel(label)) === code;
  return { itemCode: code, confidence: exact ? "exact" : "fuzzy" };
}

function baseRow(item: MergedItem, key: string): Omit<DraftRow, "value" | "ref" | "flag" | "note" | "followUp" | "followUpDue"> {
  const match = matchExtracted(item.label, item.section);
  return {
    key,
    label: item.label,
    section: item.section,
    unit: item.unit,
    itemCode: match.itemCode,
    confidence: match.confidence,
    conflict: item.conflict,
    include: match.itemCode !== null,
    overwrite: false,
    touchedFor: null,
  };
}

/**
 * 금회 회차 (첫 번째) + 과거결과 열 날짜별 회차 (최근 순) + 날짜를 못 읽은 회차 (원문 표기별 · 맨 뒤 · 사용자가 날짜 입력).
 * 과거 값은 값만 — 결과지 과거 열에 없는 판정 · 기준범위 · 판독문은 만들지 않는다.
 * 날짜가 같아지는 회차 (금회 = 과거 · 날짜를 넣은 미확인 회차) 는 요청 조립 (effectiveRounds) 이 합친다.
 */
export function buildDraftRounds(merged: MergedExtraction, todayYmd: string): DraftRound[] {
  const currentRows: DraftRow[] = merged.items.map((item, i) => ({
    ...baseRow(item, `current:${i}`),
    value: item.value,
    ref: item.ref,
    flag: item.flag,
    note: item.note,
    followUp: item.followUp,
    followUpDue: null,
  }));
  const past = new Map<string, { date: string | null; dateText: string | null; rows: DraftRow[] }>();
  merged.items.forEach((item, i) => {
    for (const raw of item.past) {
      // 오늘 뒤 날짜는 잘못 읽은 것 — 날짜 확인 필요 회차로 (서버가 미래 날짜를 거부한다 · PR 전 리뷰 major 3)
      const p = raw.date && raw.date > todayYmd ? { ...raw, date: null, dateText: raw.dateText ?? raw.date } : raw;
      const key = pastKey(p);
      const group = past.get(key) ?? { date: p.date, dateText: p.date ? null : p.dateText, rows: [] };
      const row: DraftRow = {
        ...baseRow(item, `${key}:${i}`),
        value: p.value,
        ref: null,
        flag: null,
        note: null,
        followUp: null,
        followUpDue: null,
        // 미래 날짜라 날짜 확인 필요로 옮긴 값은 키가 바뀐다 — 원래 키로 기록된 충돌도 본다 (#533 · PR #534 Codex 3회차 P2)
        conflict: item.pastConflicts.includes(key) || item.pastConflicts.includes(pastKey(raw)),
      };
      past.set(key, { ...group, rows: [...group.rows, row] });
    }
  });
  const pastRounds: DraftRound[] = [...past.entries()]
    .map(([key, g]) => ({ key, current: false, date: g.date, dateText: g.dateText, needsDate: g.date === null, rows: g.rows }))
    .sort((a, b) => (a.date && b.date ? b.date.localeCompare(a.date) : a.date ? -1 : b.date ? 1 : a.key.localeCompare(b.key)));
  return [
    { key: "current", current: true, date: merged.examDate, dateText: null, needsDate: false, rows: currentRows },
    ...pastRounds,
  ];
}

/** 포함된 행 중 앞 행과 같은 itemCode 로 매칭된 행 → 앞 행의 원문 이름 (저장을 막는다 · `@@unique([checkupId, itemCode])`) */
export function duplicateRows(rows: readonly DraftRow[]): Map<string, string> {
  const first = new Map<string, string>();
  const dups = new Map<string, string>();
  for (const row of rows) {
    if (!row.include || !row.itemCode) continue;
    const prev = first.get(row.itemCode);
    if (prev === undefined) first.set(row.itemCode, row.label);
    else dups.set(row.key, prev);
  }
  return dups;
}
