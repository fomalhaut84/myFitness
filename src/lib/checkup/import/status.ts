// #532: 초안 행 ↔ 같은 날짜 기존 회차 비교 — 새 항목 / 같은 값 / 값 다름 + 기본 포함 여부. 순수.
import { valueKey } from "./merge";
import type { DraftRound, DraftRow } from "./draft";

export type RowStatus = "new" | "same" | "different";

export interface ExistingResult {
  itemCode: string;
  valueNum: number | null;
  valueText: string | null;
}

export interface ExistingRound {
  id: string;
  date: string;
  results: readonly ExistingResult[];
}

const NUM_RE = /^-?\d+(?:\.\d+)?$/;

/** 원문 비교 (공백 · 전각 무시) — 둘 다 수치면 값으로 (`12.30` = `12.3`) */
export function sameValue(value: string, existing: ExistingResult): boolean {
  const a = valueKey(value);
  const b = valueKey(existing.valueText ?? (existing.valueNum !== null ? String(existing.valueNum) : ""));
  if (a === b) return true;
  return NUM_RE.test(a) && NUM_RE.test(b) && Number(a) === Number(b);
}

export function rowStatus(row: Pick<DraftRow, "itemCode" | "value">, existing: ExistingRound | null): { status: RowStatus; existing: ExistingResult | null } {
  const found = row.itemCode ? existing?.results.find((r) => r.itemCode === row.itemCode) ?? null : null;
  if (!found) return { status: "new", existing: null };
  return { status: sameValue(row.value, found) ? "same" : "different", existing: found };
}

/**
 * 기존 회차를 불러온 뒤 한 번 적용하는 기본값: 같은 값은 빼고, 값이 다르면 포함하되 덮어쓰기는 끈다
 * (체크하지 않으면 저장 때 건너뛴다 · 스펙 §3-2). 사용자가 바꾼 뒤에는 다시 부르지 않는다.
 */
export function applyExistingDefaults(round: DraftRound, existing: ExistingRound | null): DraftRound {
  if (!existing) return round;
  return {
    ...round,
    rows: round.rows.map((row) => {
      const { status } = rowStatus(row, existing);
      if (status === "same") return { ...row, include: false, overwrite: false };
      if (status === "different") return { ...row, overwrite: false };
      return row;
    }),
  };
}

export interface ImportSummary {
  newRounds: number;
  existingRounds: number;
  /** 새 회차 행 + 기존 회차에 추가될 새 항목 */
  added: number;
  overwritten: number;
  /** 포함했지만 기존 값 유지로 건너뛸 행 (같은 값 · 덮어쓰기 안 한 다른 값) */
  skipped: number;
  /** 같은 날짜 기존 회차를 아직 불러오는 중인 회차가 있다 */
  loading: boolean;
}

/** 저장 바 요약 — 회차 날짜별 기존 회차 (undefined = 불러오는 중) 기준. 서버 planRound 와 같은 규칙. */
export function summarizeImport(
  rounds: readonly Pick<DraftRound, "date" | "rows">[],
  existingFor: (date: string) => ExistingRound | null | undefined,
): ImportSummary {
  const summary: ImportSummary = { newRounds: 0, existingRounds: 0, added: 0, overwritten: 0, skipped: 0, loading: false };
  for (const round of rounds) {
    const rows = round.rows.filter((r) => r.include && r.itemCode);
    if (rows.length === 0 || !round.date) continue;
    const existing = existingFor(round.date);
    if (existing === undefined) {
      summary.loading = true;
      continue;
    }
    if (existing === null) {
      summary.newRounds += 1;
      summary.added += rows.length;
      continue;
    }
    summary.existingRounds += 1;
    for (const row of rows) {
      const { status } = rowStatus(row, existing);
      if (status === "new") summary.added += 1;
      else if (status === "different" && row.overwrite) summary.overwritten += 1;
      else summary.skipped += 1;
    }
  }
  return summary;
}
