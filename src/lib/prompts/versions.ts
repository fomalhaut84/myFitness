// #552 M19-1: 프롬프트 버전 조회 · 쓰기 (API 전용). 버전 본문은 불변 — 새 버전을 쌓고 status 만 바꾼다 (S3).
// 저장 · 활성화 · 되돌리기 모두 validatePrompt 를 다시 통과해야 한다 (R3).
import prisma from "@/lib/prisma";
import { PROMPT_DEFINITIONS, PROMPT_KEYS, type PromptKey } from "./definitions";
import { type PromptSource, type PromptStatus } from "./sync-plan";
import { validatePrompt, type PromptIssue } from "./validate";

export interface PromptVersionDTO {
  id: string;
  version: number;
  body: string;
  note: string | null;
  status: PromptStatus;
  source: PromptSource;
  basedOnVersion: number | null;
  createdAt: string;
  activatedAt: string | null;
}

export interface PromptSummaryDTO {
  key: PromptKey;
  active: { version: number; source: PromptSource; activatedAt: string | null } | null;
  draftCount: number;
  /** 웹에서 고친 버전을 쓰는 중에 코드 기본값이 바뀌어 초안으로 들어옴 (R2) */
  pendingCodeDefault: boolean;
}

/** API 가 상태 코드 · 사용자 문구로 바꾸는 예상된 실패 */
export class PromptActionError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
    readonly issues: PromptIssue[] = [],
  ) {
    super(message);
  }
}

interface VersionRow {
  id: string;
  codeHash: string | null;
  key: string;
  version: number;
  body: string;
  note: string | null;
  status: string;
  source: string;
  basedOnId: string | null;
  createdAt: Date;
  activatedAt: Date | null;
}

function toDTO(row: VersionRow, versionById: ReadonlyMap<string, number>): PromptVersionDTO {
  return {
    id: row.id,
    version: row.version,
    body: row.body,
    note: row.note,
    status: row.status as PromptStatus,
    source: row.source as PromptSource,
    basedOnVersion: row.basedOnId ? (versionById.get(row.basedOnId) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
  };
}

export function summarize(key: PromptKey, rows: readonly Pick<VersionRow, "version" | "status" | "source" | "activatedAt">[]): PromptSummaryDTO {
  const active = rows.find((r) => r.status === "active") ?? null;
  const drafts = rows.filter((r) => r.status === "draft");
  return {
    key,
    active: active ? { version: active.version, source: active.source as PromptSource, activatedAt: active.activatedAt?.toISOString() ?? null } : null,
    draftCount: drafts.length,
    // 사용 중보다 새 코드 기본값 초안은 사용 중이 웹 수정본일 때만 생긴다 (R2). 그 뒤 다른 버전을 활성화하면 경고는 사라지고 초안은 이력에 남는다
    pendingCodeDefault: active !== null && drafts.some((d) => d.source === "code_default" && d.version > active.version),
  };
}

export async function listPromptSummaries(): Promise<PromptSummaryDTO[]> {
  const rows = await prisma.promptVersion.findMany({ select: { key: true, version: true, status: true, source: true, activatedAt: true } });
  return PROMPT_KEYS.map((key) => summarize(key, rows.filter((r) => r.key === key)));
}

export async function listVersions(key: PromptKey): Promise<PromptVersionDTO[]> {
  const rows = await prisma.promptVersion.findMany({ where: { key }, orderBy: { version: "desc" } });
  const versionById = new Map(rows.map((r) => [r.id, r.version]));
  return rows.map((r) => toDTO(r, versionById));
}

function assertValid(key: PromptKey, body: string): void {
  const { errors } = validatePrompt(key, body);
  if (errors.length > 0) throw new PromptActionError(400, "프롬프트 검증을 통과하지 못했습니다", errors);
}

async function findVersion(id: string): Promise<VersionRow & { key: PromptKey }> {
  const row = await prisma.promptVersion.findUnique({ where: { id } });
  if (!row || !(PROMPT_KEYS as readonly string[]).includes(row.key)) throw new PromptActionError(404, "버전을 찾을 수 없습니다");
  return row as VersionRow & { key: PromptKey };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

interface InsertInput {
  key: PromptKey;
  body: string;
  note: string | null;
  source: Exclude<PromptSource, "code_default">;
  basedOnId: string | null;
  activate: boolean;
  /** 되돌리기만 — 원본의 codeHash 를 물려받아 이후 코드 기본값 갱신이 자동 적용되게 (isStockDefault). 되돌린 restore 를 다시 되돌려도 유지 (PR #553 Codex P2) · 직접 수정 · AI 제안 행은 원래 null */
  codeHash?: string | null;
}

/** 다음 번호로 새 버전 — activate 면 같은 트랜잭션에서 이전 사용 중을 보관으로 */
async function insertVersion(input: InsertInput): Promise<{ id: string; version: number }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const last = await tx.promptVersion.findFirst({ where: { key: input.key }, orderBy: { version: "desc" }, select: { version: true } });
      const version = (last?.version ?? 0) + 1;
      if (input.activate) {
        await tx.promptVersion.updateMany({ where: { key: input.key, status: "active" }, data: { status: "archived" } });
      }
      return tx.promptVersion.create({
        data: {
          key: input.key,
          version,
          body: input.body,
          note: input.note,
          status: input.activate ? "active" : "draft",
          source: input.source,
          basedOnId: input.basedOnId,
          codeHash: input.codeHash ?? null,
          activatedAt: input.activate ? new Date() : null,
        },
        select: { id: true, version: true },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PromptActionError(409, "다른 곳에서 먼저 저장했습니다. 새로고침 후 다시 시도하세요");
    throw error;
  }
}

export async function createVersion(params: {
  key: PromptKey;
  body: string;
  note: string | null;
  basedOnId: string | null;
  activate: boolean;
}): Promise<{ id: string; version: number }> {
  assertValid(params.key, params.body);
  if (params.basedOnId) {
    const base = await findVersion(params.basedOnId);
    if (base.key !== params.key) throw new PromptActionError(400, "다른 프롬프트의 버전에서 고칠 수 없습니다");
  }
  return insertVersion({ ...params, source: "manual" });
}

/** 초안을 사용 중으로. 보관된 버전은 "되돌리기" (새 버전으로 복사) 로만 — 이력이 시간 순으로 읽히게 (A5) */
export async function activateVersion(id: string): Promise<{ version: number }> {
  const row = await findVersion(id);
  if (row.status === "active") return { version: row.version };
  if (row.status !== "draft") throw new PromptActionError(409, "보관된 버전은 되돌리기로 다시 사용할 수 있습니다");
  assertValid(row.key, row.body);
  try {
    await prisma.$transaction([
      prisma.promptVersion.updateMany({ where: { key: row.key, status: "active" }, data: { status: "archived" } }),
      prisma.promptVersion.update({ where: { id }, data: { status: "active", activatedAt: new Date() } }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new PromptActionError(409, "다른 곳에서 먼저 바꿨습니다. 새로고침 후 다시 시도하세요");
    throw error;
  }
  return { version: row.version };
}

export async function restoreVersion(id: string): Promise<{ id: string; version: number }> {
  const row = await findVersion(id);
  if (row.status !== "archived") throw new PromptActionError(409, "보관된 버전만 되돌릴 수 있습니다 (초안은 활성화)");
  assertValid(row.key, row.body);
  return insertVersion({ key: row.key, body: row.body, note: `v${row.version} 로 되돌림`, source: "restore", basedOnId: row.id, activate: true, codeHash: row.codeHash });
}

