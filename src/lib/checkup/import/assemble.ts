// #532: 확인 화면 상태 → POST /api/checkups/import 본문. 저장을 막는 이유도 여기서 (화면 · 저장 버튼 공용). 순수.
import { isValidYmd } from "@/lib/history/buckets";
import { duplicateRows, type DraftRound, type DraftRow } from "./draft";
import type { ExtractedPage } from "./extract-schema";
import type { ImportRequestBody, ImportResultBody, ImportSource } from "./request";

export interface ImportHeader {
  date: string;
  institution: string;
  kind: "national" | "comprehensive" | "other";
}

export interface ImportFinding {
  key: string;
  category: string;
  text: string;
  include: boolean;
}

export interface AssembleInput {
  source: ImportSource;
  header: ImportHeader;
  rounds: readonly DraftRound[];
  findings: readonly ImportFinding[];
  pages: readonly ExtractedPage[];
}

export type AssembleResult = { ok: true; body: ImportRequestBody } | { ok: false; reasons: string[] };

function toResult(row: DraftRow): ImportResultBody {
  return {
    itemCode: row.itemCode as string,
    label: row.label,
    category: row.section ?? undefined,
    value: row.value,
    unit: row.unit,
    ref: row.ref,
    flag: row.flag,
    note: row.note,
    followUp: row.followUp,
    followUpDue: row.followUpDue,
    overwrite: row.overwrite,
  };
}

/** 금회 검진일과 같은 날짜의 과거 회차는 금회에 합친다 — 금회에 없는 항목만 (금회 행이 판정 · 기준범위를 가진다) */
export function effectiveRounds(rounds: readonly DraftRound[], currentDate: string): DraftRound[] {
  const current = rounds.find((r) => r.current);
  const same = rounds.find((r) => !r.current && r.date === currentDate);
  const rest = rounds.filter((r) => !r.current && r !== same);
  if (!current) return rest;
  const codes = new Set(current.rows.filter((r) => r.include).map((r) => r.itemCode));
  const extra = same ? same.rows.filter((r) => !codes.has(r.itemCode)) : [];
  return [{ ...current, date: currentDate, rows: [...current.rows, ...extra] }, ...rest];
}

export function blockingReasons(input: Pick<AssembleInput, "header" | "rounds">): string[] {
  const reasons: string[] = [];
  const currentHasRows = input.rounds.some((r) => r.current && r.rows.some((row) => row.include));
  if (currentHasRows && !isValidYmd(input.header.date)) reasons.push("금회 검진일을 입력하세요");
  const rounds = isValidYmd(input.header.date) ? effectiveRounds(input.rounds, input.header.date) : input.rounds;
  const dupCount = rounds.reduce((n, r) => n + duplicateRows(r.rows).size, 0);
  if (dupCount > 0) reasons.push(`같은 항목으로 매칭된 행 ${dupCount}개를 정리하세요`);
  const unnamed = rounds.flatMap((r) => r.rows).filter((row) => row.include && !row.itemCode).length;
  if (unnamed > 0) reasons.push(`항목을 알아볼 수 없는 행 ${unnamed}개를 빼거나 매칭하세요`);
  if (!rounds.some((r) => r.rows.some((row) => row.include))) reasons.push("저장할 행이 없습니다");
  return reasons;
}

export function assembleImport(input: AssembleInput): AssembleResult {
  const reasons = blockingReasons(input);
  if (reasons.length > 0) return { ok: false, reasons };
  const { header } = input;
  const institution = header.institution.trim() || null;
  const rounds = effectiveRounds(input.rounds, header.date)
    .map((round) => ({ round, rows: round.rows.filter((r) => r.include) }))
    .filter(({ round, rows }) => rows.length > 0 && round.date !== null)
    .map(({ round, rows }) => ({
      date: round.date as string,
      institution,
      kind: header.kind,
      findings: round.current
        ? input.findings.filter((f) => f.include).map((f) => ({ category: f.category, text: f.text }))
        : null,
      results: rows.map(toResult),
    }));
  return { ok: true, body: { source: input.source, rounds, pages: [...input.pages] } };
}
