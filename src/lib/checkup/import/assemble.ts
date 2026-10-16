// #532: 확인 화면 상태 → POST /api/checkups/import 본문. 저장을 막는 이유도 여기서 (화면 · 저장 버튼 공용). 순수.
import { isValidYmd } from "@/lib/history/buckets";
import { duplicateRows, type DraftRound, type DraftRow } from "./draft";
import type { ExtractedPage } from "./extract-schema";
import { followUpDueFrom } from "./follow-up";
import { MAX_RESULTS_PER_ROUND, type ImportRequestBody, type ImportResultBody, type ImportSource } from "./request";

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
  /** 오늘 (KST) — 이 뒤 날짜는 저장할 수 없다 */
  today: string;
  source: ImportSource;
  header: ImportHeader;
  rounds: readonly DraftRound[];
  findings: readonly ImportFinding[];
  pages: readonly ExtractedPage[];
}

export type AssembleResult = { ok: true; body: ImportRequestBody } | { ok: false; reasons: string[] };

/** 사용자가 고른 예정일 → 없으면 권고 원문 + 검진일로 계산한 값 (화면 표시와 같은 규칙) */
export function effectiveFollowUpDue(row: Pick<DraftRow, "followUp" | "followUpDue">, date: string | null): string | null {
  return row.followUpDue ?? followUpDueFrom(row.followUp, date);
}

function toResult(row: DraftRow, date: string): ImportResultBody {
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
    followUpDue: effectiveFollowUpDue(row, date),
    overwrite: row.overwrite,
  };
}

/** 회차의 저장 날짜 — 금회는 헤더 입력값 · 그 외는 회차 날짜 (날짜 미확인 회차는 사용자가 넣은 값). 실제 날짜가 아니면 null */
export function roundDate(round: Pick<DraftRound, "current" | "date">, currentDate: string): string | null {
  const date = round.current ? currentDate : round.date;
  return date && isValidYmd(date) ? date : null;
}

/**
 * 같은 날짜가 된 회차는 앞 회차 (금회 → 최근 과거 순) 에 합친다 — 앞 회차에 포함된 항목이 없는 행만.
 * 금회 검진일 = 과거결과 열 날짜, 날짜 미확인 회차에 다른 회차 날짜를 넣은 경우. 날짜가 없는 회차는 그대로 둔다 (저장을 막는다).
 */
export function effectiveRounds(rounds: readonly DraftRound[], currentDate: string): DraftRound[] {
  const out: DraftRound[] = [];
  const byDate = new Map<string, number>();
  for (const round of rounds) {
    const date = roundDate(round, currentDate);
    const at = date ? byDate.get(date) : undefined;
    if (at === undefined) {
      if (date) byDate.set(date, out.length);
      out.push({ ...round, date });
      continue;
    }
    const target = out[at];
    const codes = new Set(target.rows.filter((r) => r.include).map((r) => r.itemCode));
    out[at] = { ...target, rows: [...target.rows, ...round.rows.filter((r) => !codes.has(r.itemCode))] };
  }
  return out;
}

export function blockingReasons(input: Pick<AssembleInput, "header" | "rounds" | "today">): string[] {
  const reasons: string[] = [];
  const currentHasRows = input.rounds.some((r) => r.current && r.rows.some((row) => row.include));
  if (currentHasRows && !isValidYmd(input.header.date)) reasons.push("금회 검진일을 입력하세요");
  const future = input.rounds.filter((r) => {
    const date = roundDate(r, input.header.date);
    return date !== null && date > input.today && r.rows.some((row) => row.include);
  }).length;
  if (future > 0) reasons.push(`오늘 이후 날짜의 회차 ${future}개 — 날짜를 고치세요`);
  const undated = input.rounds.filter((r) => !r.current && !roundDate(r, "") && r.rows.some((row) => row.include)).length;
  if (undated > 0) reasons.push(`날짜를 확인하지 않은 과거 회차 ${undated}개 — 날짜를 넣거나 행을 빼세요`);
  const rounds = effectiveRounds(input.rounds, input.header.date);
  const dupCount = rounds.reduce((n, r) => n + duplicateRows(r.rows).size, 0);
  if (dupCount > 0) reasons.push(`같은 항목으로 매칭된 행 ${dupCount}개를 정리하세요`);
  const unnamed = rounds.flatMap((r) => r.rows).filter((row) => row.include && !row.itemCode).length;
  if (unnamed > 0) reasons.push(`항목을 알아볼 수 없는 행 ${unnamed}개를 빼거나 매칭하세요`);
  const oversized = rounds.filter((r) => r.rows.filter((row) => row.include).length > MAX_RESULTS_PER_ROUND).length;
  if (oversized > 0) reasons.push(`한 회차에 ${MAX_RESULTS_PER_ROUND}개가 넘는 행이 있습니다 — 나눠서 가져오세요`);
  if (!rounds.some((r) => r.rows.some((row) => row.include))) reasons.push("포함한 행이 없습니다 — 같은 값은 이미 저장돼 있습니다");
  return reasons;
}

export function assembleImport(input: AssembleInput): AssembleResult {
  const reasons = blockingReasons(input);
  if (reasons.length > 0) return { ok: false, reasons };
  const { header } = input;
  const institution = header.institution.trim() || null;
  const rounds = effectiveRounds(input.rounds, header.date)
    .map((round) => ({ round, rows: round.rows.filter((r) => r.include) }))
    .filter(({ round, rows }) => rows.length > 0 && round.date !== null && isValidYmd(round.date))
    .map(({ round, rows }) => ({
      date: round.date as string,
      institution,
      kind: header.kind,
      findings: round.current
        ? input.findings.filter((f) => f.include).map((f) => ({ category: f.category, text: f.text }))
        : null,
      results: rows.map((row) => toResult(row, round.date as string)),
    }));
  return { ok: true, body: { source: input.source, rounds, pages: [...input.pages] } };
}
