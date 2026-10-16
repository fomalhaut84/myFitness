// #532: 초안 행 ↔ 같은 날짜 기존 회차 비교 — 새 항목 / 같은 값 / 값 다름 + 기본 포함 여부. 순수.
import { valueKey } from "./merge";
import type { DraftRound, DraftRow } from "./draft";

export type RowStatus = "new" | "same" | "different";

export interface ExistingResult {
  itemCode: string;
  valueNum: number | null;
  valueText: string | null;
  unit: string | null;
}

export interface ExistingRound {
  id: string;
  date: string;
  results: readonly ExistingResult[];
}

const NUM_RE = /^-?\d+(?:\.\d+)?$/;

/**
 * 결과지에 단위가 적혀 있고 저장된 단위와 다르거나 저장된 단위가 없으면 같은 값이 아니다 — 덮어쓰기로 단위를 고치거나
 * 채울 수 있게 (PR #534 · #536 Codex P2). 결과지에 단위가 없으면 (온라인 화면) 비교하지 않는다.
 */
function sameUnit(unit: string | null, existing: ExistingResult): boolean {
  if (!unit) return true;
  if (!existing.unit) return false;
  return valueKey(unit).toLowerCase() === valueKey(existing.unit).toLowerCase();
}

/** 원문 비교 (공백 · 전각 무시) — 둘 다 수치면 값으로 (`12.30` = `12.3`) */
export function sameValue(value: string, existing: ExistingResult): boolean {
  const a = valueKey(value);
  const b = valueKey(existing.valueText ?? (existing.valueNum !== null ? String(existing.valueNum) : ""));
  if (a === b) return true;
  return NUM_RE.test(a) && NUM_RE.test(b) && Number(a) === Number(b);
}

export function rowStatus(
  row: Pick<DraftRow, "itemCode" | "value"> & { unit?: string | null },
  existing: ExistingRound | null,
): { status: RowStatus; existing: ExistingResult | null } {
  const found = row.itemCode ? existing?.results.find((r) => r.itemCode === row.itemCode) ?? null : null;
  if (!found) return { status: "new", existing: null };
  return { status: sameValue(row.value, found) && sameUnit(row.unit ?? null, found) ? "same" : "different", existing: found };
}

/**
 * 회차 날짜의 기존 회차 (없으면 null) 기준 기본값 — 같은 값은 빼고, 새 항목 · 값 다름은 포함하되 덮어쓰기는 끈다
 * (체크하지 않으면 저장 때 건너뛴다 · 스펙 §3-2). 회차 날짜가 바뀔 때마다 다시 부른다 — 이전 날짜의 기본값
 * (같은 값이라 뺀 행) 이 새 날짜에 남지 않도록 현재 값이 아니라 처음부터 계산한다 (PR 전 리뷰 major 1).
 */
export function applyExistingDefaults(round: DraftRound, existing: ExistingRound | null): DraftRound {
  return {
    ...round,
    rows: round.rows.map((row) => {
      const status = existing ? rowStatus(row, existing).status : "new";
      return { ...row, include: row.itemCode !== null && status !== "same", overwrite: false };
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
