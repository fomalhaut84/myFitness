// #552 R1 · R2: 실제로 쓰는 프롬프트 = DB 사용 중 (active) 버전. DB 오류 · 사용 중 없음 · 치환 실패면 코드 기본값 — 리포트가 멈추지 않게.
// prisma 의존이라 순수 모듈 (definitions · validate · render · diff) 과 분리 (memory: Next RSC 경계 — 클라이언트 편집기가 그쪽을 import).
import { createHash } from "node:crypto";
import prisma from "@/lib/prisma";
import { PROMPT_DEFINITIONS, PROMPT_KEYS, type PromptKey } from "./definitions";
import { renderPrompt } from "./render";
import { planDefaultsSync, type SyncRow } from "./sync-plan";

export interface ResolvedTemplate {
  body: string;
  /** 코드 기본값으로 폴백했으면 null */
  versionId: string | null;
  fallback: boolean;
}

export interface ResolvedPrompt {
  text: string;
  versionId: string | null;
  fallback: boolean;
}

export function codeHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultTemplate(key: PromptKey): ResolvedTemplate {
  return { body: PROMPT_DEFINITIONS[key].defaultBody, versionId: null, fallback: true };
}

/** 사용 중 본문 (치환 전). 운동 평가처럼 호출자가 직접 치환하는 경우 */
export async function resolvePromptTemplate(key: PromptKey): Promise<ResolvedTemplate> {
  try {
    const row = await prisma.promptVersion.findFirst({ where: { key, status: "active" }, select: { id: true, body: true } });
    if (!row) {
      console.warn(`[prompts] ${key}: 사용 중 버전 없음 — 코드 기본값 사용`);
      return defaultTemplate(key);
    }
    return { body: row.body, versionId: row.id, fallback: false };
  } catch (error) {
    console.warn(`[prompts] ${key}: 조회 실패 — 코드 기본값 사용:`, errorMessage(error));
    return defaultTemplate(key);
  }
}

export async function resolvePrompt(key: PromptKey, vars: Readonly<Record<string, string>> = {}): Promise<ResolvedPrompt> {
  const template = await resolvePromptTemplate(key);
  try {
    return { text: renderPrompt(template.body, vars), versionId: template.versionId, fallback: template.fallback };
  } catch (error) {
    console.warn(`[prompts] ${key}: 치환 실패 (version=${template.versionId}) — 코드 기본값 사용:`, errorMessage(error));
    return { text: renderPrompt(PROMPT_DEFINITIONS[key].defaultBody, vars), versionId: null, fallback: true };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

async function syncKey(key: PromptKey): Promise<void> {
  const body = PROMPT_DEFINITIONS[key].defaultBody;
  const hash = codeHash(body);
  const rows = await prisma.promptVersion.findMany({
    where: { key },
    select: { id: true, version: true, status: true, source: true, codeHash: true },
  });
  const action = planDefaultsSync(rows as SyncRow[], hash);
  if (action.kind === "none") return;

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (action.archiveId) {
      await tx.promptVersion.update({ where: { id: action.archiveId }, data: { status: "archived" } });
    }
    await tx.promptVersion.create({
      data: {
        key,
        version: action.version,
        body,
        note: action.version === 1 ? "처음 가져온 코드 프롬프트" : "업데이트로 바뀐 기본 프롬프트",
        status: action.status,
        source: "code_default",
        codeHash: hash,
        activatedAt: action.status === "active" ? now : null,
      },
    });
  });
  if (action.status === "draft") {
    console.warn(`[prompts] ${key}: 코드 기본값이 바뀌었지만 웹에서 고친 버전을 사용 중 — v${action.version} 초안으로 추가 (화면에서 반영 필요)`);
  } else {
    console.log(`[prompts] ${key}: 코드 기본값 v${action.version} 사용`);
  }
}

/**
 * 키마다 코드 기본값을 DB 와 맞춘다 (R2). 웹 · 봇 프로세스 시작 시 + 목록 화면에서 호출 — idempotent.
 * 두 프로세스가 동시에 같은 버전을 넣으면 한쪽은 (key, version) · active unique 위반 → 다른 쪽이 이미 넣은 것이라 무시.
 */
export async function ensureDefaults(): Promise<void> {
  for (const key of PROMPT_KEYS) {
    try {
      await syncKey(key);
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      console.error(`[prompts] ${key}: 코드 기본값 동기화 실패:`, errorMessage(error));
    }
  }
}
