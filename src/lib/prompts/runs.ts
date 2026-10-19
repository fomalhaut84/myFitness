// #552 M19-3: 개선안 · 시험 실행 job (PromptRun). 시작 → 백그라운드 실행 → done/failed. 실행 중은 전체 1건 (DB partial unique).
// 실행은 웹 프로세스 안에서만 돈다 → 부팅 시 남은 running 은 모두 끊긴 것 (sweepRunsOnBoot).
import { getAskAdvisorMaxTotalBudgetMs } from "@/lib/ai/claude-advisor";
import prisma from "@/lib/prisma";
import type { PromptKey } from "./definitions";
import { SUGGEST_TIMEOUT_MS } from "./suggest-prompt";
import { RUN_ERROR_MAX_LENGTH, RUN_RESPONSE_MAX_LENGTH, clip, staleCutoff, type RunKind, type RunStatus } from "./run-plan";
import { readStoredSuggestion, type SuggestionResult } from "./suggest-prompt";
import { PromptActionError } from "./versions";

export interface PromptRunDTO {
  id: string;
  kind: RunKind;
  versionId: string;
  targetKind: "report" | "activity" | null;
  targetRef: string | null;
  status: RunStatus;
  /** trial 결과 본문 */
  response: string | null;
  /** suggest 결과 (검증 포함) — 저장된 JSON 이 깨졌으면 null */
  suggestion: SuggestionResult | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface RunRow {
  id: string;
  kind: string;
  versionId: string;
  targetKind: string | null;
  targetRef: string | null;
  status: string;
  response: string | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

/** 로그에 남기는 실패 메시지 길이 */
const RUN_LOG_ERROR_MAX_LENGTH = 300;

const BUSY_MESSAGE = "이미 실행 중인 개선안 · 시험 실행이 있습니다. 끝난 뒤 다시 시도하세요";

function toRunDTO(row: RunRow, key: PromptKey): PromptRunDTO {
  const kind = row.kind as RunKind;
  return {
    id: row.id,
    kind,
    versionId: row.versionId,
    targetKind: row.targetKind as PromptRunDTO["targetKind"],
    targetRef: row.targetRef,
    status: row.status as RunStatus,
    response: kind === "trial" ? row.response : null,
    suggestion: kind === "suggest" && row.status === "done" ? readStoredSuggestion(key, row.response) : null,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 끊긴 실행 정리 — 시작 전에 오래된 running 을 failed 로 (부팅 정리를 놓친 경우 대비) */
async function failStaleRuns(): Promise<void> {
  await prisma.promptRun.updateMany({
    where: { status: "running", startedAt: { lt: staleCutoff(Math.max(getAskAdvisorMaxTotalBudgetMs(), SUGGEST_TIMEOUT_MS)) } },
    data: { status: "failed", errorMessage: "시간 초과 — 실행이 끝나지 않았습니다", completedAt: new Date() },
  });
}

/**
 * 부팅 정리 — 이 프로세스가 뜨기 전에 시작된 running 만. pm2 startOrReload 로 새 워커가 정리 전에 요청을 받으면
 * 방금 시작한 실행까지 failed 로 바꿔 결과를 잃는다 (PR #560 Codex P2). startedAt 은 startRun 이 앱 시계로 넣는다
 */
export async function sweepRunsOnBoot(bootedAt: Date): Promise<void> {
  const { count } = await prisma.promptRun.updateMany({
    where: { status: "running", startedAt: { lt: bootedAt } },
    data: { status: "failed", errorMessage: "서버 재시작으로 중단됐습니다", completedAt: new Date() },
  });
  if (count > 0) console.warn(`[prompt-run] 재시작으로 끊긴 실행 ${count}건을 실패로 정리`);
}

/**
 * running 행을 만들고 `work` 를 백그라운드로 돌린다. 결과 문자열 → done, throw → failed (메시지 보관).
 * 동시 실행은 partial unique 위반 → 409.
 */
export async function startRun(
  data: { kind: RunKind; versionId: string; targetKind?: "report" | "activity"; targetRef?: string },
  work: () => Promise<string>,
): Promise<{ id: string }> {
  await failStaleRuns();
  let run: { id: string };
  try {
    run = await prisma.promptRun.create({
      data: { kind: data.kind, versionId: data.versionId, targetKind: data.targetKind ?? null, targetRef: data.targetRef ?? null, status: "running", startedAt: new Date() },
      select: { id: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PromptActionError(409, BUSY_MESSAGE);
    throw error;
  }
  void finishRun(run.id, data.kind, work);
  return run;
}

async function finishRun(id: string, kind: RunKind, work: () => Promise<string>): Promise<void> {
  try {
    const response = await work();
    // running 일 때만 — 정리 (부팅 · 오래된 실행) 가 먼저 failed 로 바꿨으면 늦은 완료가 뒤집지 않는다 (사전 리뷰 info 2)
    await prisma.promptRun.updateMany({ where: { id, status: "running" }, data: { status: "done", response: clip(response, RUN_RESPONSE_MAX_LENGTH), completedAt: new Date() } });
    console.log(`[prompt-run] ${kind} ${id} 완료 (length=${response.length})`);
  } catch (error) {
    // 성공 응답은 로그에 남기지 않는다. 실패 메시지는 CLI 출력 (모델 응답 일부일 수 있음) 을 담을 수 있어 잘라서 남긴다 (사전 리뷰 info 4)
    const message = clip(errorMessage(error), RUN_ERROR_MAX_LENGTH);
    console.error(`[prompt-run] ${kind} ${id} 실패:`, clip(message, RUN_LOG_ERROR_MAX_LENGTH));
    try {
      await prisma.promptRun.updateMany({ where: { id, status: "running" }, data: { status: "failed", errorMessage: message, completedAt: new Date() } });
    } catch (updateError) {
      // 남은 running 은 다음 시작의 failStaleRuns · 부팅 정리가 치운다
      console.error(`[prompt-run] ${id} 실패 기록 저장 실패:`, errorMessage(updateError));
    }
  }
}

export async function getRun(id: string): Promise<PromptRunDTO> {
  const row = await prisma.promptRun.findUnique({ where: { id }, include: { version: { select: { key: true } } } });
  if (!row) throw new PromptActionError(404, "실행 기록을 찾을 수 없습니다");
  return toRunDTO(row, row.version.key as PromptKey);
}

/** 이 프롬프트의 실행 기록 (최신순) — 화면이 버전별로 묶는다 */
export async function listRuns(key: PromptKey, limit = 50): Promise<PromptRunDTO[]> {
  const rows = await prisma.promptRun.findMany({ where: { version: { key } }, orderBy: { startedAt: "desc" }, take: limit });
  return rows.map((r) => toRunDTO(r, key));
}
