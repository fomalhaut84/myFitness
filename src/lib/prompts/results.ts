// #552 M19-2 L3 · L5: 프롬프트 버전별 AI 결과 조회 (prisma). 조건 조립은 results-query.ts (순수).
import prisma from "@/lib/prisma";
import type { PromptKey } from "./definitions";
import { buildResultsWhere, resolveVersionFilter, versionFieldFor } from "./results-query";

export interface PromptResultDTO {
  id: string;
  category: string;
  reportDate: string | null;
  createdAt: string;
  /** 이 키 기준 버전 (시스템 프롬프트면 systemPromptVersionId) */
  versionId: string | null;
  response: string;
}

async function keyVersionIds(key: PromptKey): Promise<string[]> {
  const rows = await prisma.promptVersion.findMany({ where: { key }, select: { id: true } });
  return rows.map((r) => r.id);
}

export async function listPromptResults(key: PromptKey, requested: readonly string[], limit: number): Promise<PromptResultDTO[]> {
  const filter = resolveVersionFilter(requested, await keyVersionIds(key));
  const field = versionFieldFor(key);
  const rows = await prisma.aIAdvice.findMany({
    where: buildResultsWhere(key, filter),
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, category: true, reportDate: true, createdAt: true, response: true, systemPromptVersionId: true, promptVersionId: true },
  });
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    reportDate: r.reportDate,
    createdAt: r.createdAt.toISOString(),
    versionId: r[field],
    response: r.response,
  }));
}

/** 버전별 결과 건수 (계보 레일 "결과 N건") */
export async function countResultsByVersion(key: PromptKey): Promise<Record<string, number>> {
  const ids = await keyVersionIds(key);
  if (ids.length === 0) return {};
  const field = versionFieldFor(key);
  const groups =
    field === "systemPromptVersionId"
      ? await prisma.aIAdvice.groupBy({ by: ["systemPromptVersionId"], where: { systemPromptVersionId: { in: ids } }, _count: { _all: true } })
      : await prisma.aIAdvice.groupBy({ by: ["promptVersionId"], where: { promptVersionId: { in: ids } }, _count: { _all: true } });
  return Object.fromEntries(
    groups.flatMap((g) => {
      const id = "systemPromptVersionId" in g ? g.systemPromptVersionId : g.promptVersionId;
      return id ? [[id, g._count._all]] : [];
    }),
  );
}
