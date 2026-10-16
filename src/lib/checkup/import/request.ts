// #532: POST /api/checkups/import 본문 검증 → 회차별 저장 행. 날짜 · 개수 상한 · 미래 날짜. 순수 (오늘 날짜는 호출자가 준다).
import { z } from "zod";
import { buildResultRows, type CheckupResultRow } from "../build";
import { CHECKUP_INPUT, CHECKUP_RESULT_INPUT } from "../schema";
import { EXTRACTED_PAGE } from "./extract-schema";

export const IMPORT_SOURCES = ["capture", "pdf", "photo"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export const MAX_IMPORT_ROUNDS = 20;
export const MAX_IMPORT_RESULTS = 600;
export const MAX_IMPORT_PAGES = 30;
export const MAX_RESULTS_PER_ROUND = 300;

export const IMPORT_RESULT_INPUT = CHECKUP_RESULT_INPUT.extend({
  /** 확인 화면이 매칭을 정했다 — 서버가 이름으로 다시 매칭하지 않는다 */
  itemCode: z.string().trim().min(1).max(120),
  /** 같은 날짜 회차에 이미 있는 항목을 이 값으로 바꾼다 (기본: 기존 값 유지) */
  overwrite: z.boolean().default(false),
});

export const IMPORT_ROUND_INPUT = z.object({
  date: CHECKUP_INPUT.shape.date,
  institution: CHECKUP_INPUT.shape.institution,
  kind: CHECKUP_INPUT.shape.kind,
  findings: CHECKUP_INPUT.shape.findings,
  results: z.array(IMPORT_RESULT_INPUT).min(1, "결과가 하나 이상 필요합니다").max(MAX_RESULTS_PER_ROUND),
});

export const IMPORT_INPUT = z
  .object({
    source: z.enum(IMPORT_SOURCES),
    rounds: z.array(IMPORT_ROUND_INPUT).min(1).max(MAX_IMPORT_ROUNDS),
    /** 추출 원문 — DB rawData 에만 (응답 · 로그 금지) */
    pages: z.array(EXTRACTED_PAGE).max(MAX_IMPORT_PAGES).default([]),
  })
  .superRefine((input, ctx) => {
    const total = input.rounds.reduce((n, r) => n + r.results.length, 0);
    if (total > MAX_IMPORT_RESULTS) {
      ctx.addIssue({ code: "custom", path: ["rounds"], message: `결과는 모두 ${MAX_IMPORT_RESULTS}개까지입니다` });
    }
    const dates = input.rounds.map((r) => r.date);
    if (new Set(dates).size !== dates.length) {
      ctx.addIssue({ code: "custom", path: ["rounds"], message: "같은 날짜의 회차가 두 번 들어왔습니다" });
    }
  });

export type ImportRequestBody = z.input<typeof IMPORT_INPUT>;
export type ImportResultBody = z.input<typeof IMPORT_RESULT_INPUT>;
export type ImportInput = z.output<typeof IMPORT_INPUT>;

/** 결과지가 실제로 준 필드 — 덮어쓰기는 이것만 바꾼다 (빌드가 채운 카탈로그 단위 · 계산 판정과 구분) */
export interface ProvidedFields {
  unit: boolean;
  ref: boolean;
  flag: boolean;
  note: boolean;
  followUp: boolean;
  followUpDue: boolean;
}

export type ImportRow = CheckupResultRow & { overwrite: boolean; given: ProvidedFields };

function providedFields(input: ImportInput["rounds"][number]["results"][number]): ProvidedFields {
  return {
    unit: input.unit != null,
    ref: input.ref != null,
    flag: input.flag != null,
    note: input.note != null,
    followUp: input.followUp != null,
    followUpDue: input.followUpDue != null,
  };
}

export interface PreparedRound {
  date: string;
  institution: string | null;
  kind: ImportInput["rounds"][number]["kind"];
  findings: { category: string; text: string; flag?: string | null }[] | null;
  rows: ImportRow[];
}

export type PreparedImport =
  | { ok: true; source: ImportSource; pages: ImportInput["pages"]; rounds: PreparedRound[] }
  | { ok: false; status: 400; body: { error: string; issues?: unknown } };

export function prepareImport(body: unknown, todayYmd: string): PreparedImport {
  const parsed = IMPORT_INPUT.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, body: { error: "유효하지 않은 입력", issues: parsed.error.issues } };
  }
  const rounds: PreparedRound[] = [];
  for (const round of parsed.data.rounds) {
    if (round.date > todayYmd) {
      return { ok: false, status: 400, body: { error: `미래 날짜의 검진은 기록할 수 없습니다: ${round.date}` } };
    }
    const built = buildResultRows(round.results);
    if (!built.ok) return { ok: false, status: 400, body: { error: `${round.date} 회차: ${built.error}` } };
    rounds.push({
      date: round.date,
      institution: round.institution ?? null,
      kind: round.kind,
      findings: round.findings && round.findings.length > 0 ? round.findings : null,
      // buildResultRows 는 입력 순서를 지킨다
      rows: built.rows.map((row, i) => ({ ...row, overwrite: round.results[i].overwrite, given: providedFields(round.results[i]) })),
    });
  }
  return { ok: true, source: parsed.data.source, pages: parsed.data.pages, rounds };
}
