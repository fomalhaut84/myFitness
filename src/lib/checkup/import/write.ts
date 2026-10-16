// #532: 결과지 가져오기 저장 — 모든 회차를 한 트랜잭션으로. 기존 회차는 저장 직전 상태로 다시 읽어 planRound 로 판정.
// 덮어쓰기는 행을 지우지 않고 결과지가 준 필드만 update (plan.mergeResultRow) · 이전 값은 rawData 가져오기 기록에.
import prisma from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { parseDateOnlyKST } from "@/lib/date-input";
import type { CheckupResultRow } from "../build";
import { planRound, type OverwrittenSnapshot, type RoundPlan } from "./plan";
import type { ImportRow, PreparedImport, PreparedRound } from "./request";

type Prepared = Extract<PreparedImport, { ok: true }>;

export interface ImportRoundOutcome {
  date: string;
  id: string;
  created: boolean;
  added: number;
  overwritten: number;
  skipped: number;
}

/** 20회차 × 몇 쿼리 — 기본 5초는 빠듯하다 */
const TX_TIMEOUT_MS = 20_000;

function toRow({ overwrite: _overwrite, given: _given, ...row }: ImportRow): CheckupResultRow {
  return row;
}

/** 추출 원문은 첫 회차 (보통 금회) 에만 — 회차마다 같은 원문을 반복 저장하지 않는다 (PR 전 리뷰 info 5) */
function importEntry(prepared: Prepared, at: Date, withPages: boolean) {
  return { at: at.toISOString(), source: prepared.source, ...(withPages ? { pages: prepared.pages } : { pagesOn: prepared.rounds[0]?.date }) };
}

type ImportEntry = ReturnType<typeof importEntry> & { overwritten?: OverwrittenSnapshot[] };

const STORED_SELECT = {
  id: true,
  itemCode: true,
  valueNum: true,
  valueText: true,
  unit: true,
  refText: true,
  refLow: true,
  refHigh: true,
  flag: true,
  flagSource: true,
  note: true,
  followUp: true,
  followUpDue: true,
} as const;

/** rawData = { imports: [...] } — 기존 값이 다른 형태면 보존해 둔다 */
function appendImport(raw: unknown, entry: ImportEntry): Prisma.InputJsonValue {
  const prev = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const imports = Array.isArray(prev?.imports) ? prev.imports : [];
  const kept = prev && !Array.isArray(prev.imports) ? { previous: prev } : prev ?? {};
  return { ...kept, imports: [...imports, entry] } as Prisma.InputJsonValue;
}

async function applyRound(
  tx: Prisma.TransactionClient,
  round: PreparedRound,
  prepared: Prepared,
  entry: ImportEntry,
): Promise<ImportRoundOutcome> {
  const date = parseDateOnlyKST(round.date);
  const existing = await tx.healthCheckup.findUnique({
    where: { date },
    select: { id: true, findings: true, rawData: true, results: { select: STORED_SELECT } },
  });
  const plan: RoundPlan = planRound(
    round,
    existing
      ? {
          id: existing.id,
          hasFindings: Array.isArray(existing.findings) && existing.findings.length > 0,
          results: new Map(existing.results.map((r) => [r.itemCode, r])),
        }
      : null,
  );

  if (!existing) {
    const created = await tx.healthCheckup.create({
      data: {
        date,
        institution: round.institution,
        kind: round.kind,
        source: prepared.source,
        findings: round.findings ?? Prisma.DbNull,
        rawData: appendImport(null, entry),
        results: { createMany: { data: plan.add.map(toRow) } },
      },
      select: { id: true },
    });
    return { date: round.date, id: created.id, created: true, added: plan.add.length, overwritten: 0, skipped: 0 };
  }

  for (const r of plan.replace) await tx.checkupResult.update({ where: { id: r.id }, data: r.data });
  if (plan.add.length > 0) await tx.checkupResult.createMany({ data: plan.add.map((r) => ({ ...toRow(r), checkupId: existing.id })) });
  const logged: ImportEntry = plan.replace.length > 0 ? { ...entry, overwritten: plan.replace.map((r) => r.previous) } : entry;
  // 회차 헤더 (기관 · 종류 · source) 는 바꾸지 않는다 — 섹션 소견은 비어 있을 때만 채운다
  await tx.healthCheckup.update({
    where: { id: existing.id },
    data: {
      rawData: appendImport(existing.rawData, logged),
      ...(plan.fillFindings && round.findings ? { findings: round.findings } : {}),
    },
  });
  return {
    date: round.date,
    id: existing.id,
    created: false,
    added: plan.add.length,
    overwritten: plan.replace.length,
    skipped: plan.skipped,
  };
}

/** 하나라도 실패하면 전부 롤백. 같은 날짜 동시 생성은 P2002 (호출자가 409). */
export async function importCheckups(prepared: Prepared, now: Date = new Date()): Promise<ImportRoundOutcome[]> {
  return prisma.$transaction(
    async (tx) => {
      const outcomes: ImportRoundOutcome[] = [];
      for (const [i, round] of prepared.rounds.entries()) {
        outcomes.push(await applyRound(tx, round, prepared, importEntry(prepared, now, i === 0)));
      }
      return outcomes;
    },
    { timeout: TX_TIMEOUT_MS },
  );
}
