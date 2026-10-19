// #552 M19-3 T2 · T3: 초안 시험 실행 — 초안 본문으로 리포트 · 평가를 지금 시점 기준 1회 생성한다. AIAdvice 에 저장하지 않는다.
// Garmin 사전 싱크 생략 · 전용 채널 새 세션. 시스템 프롬프트 초안은 고른 대상을 그 초안으로 (askAdvisor systemOverride).
import { askAdvisor, resetSession } from "@/lib/ai/claude-advisor";
import { buildEvalContext } from "@/lib/ai/activity-eval/build-context";
import { ACTIVITY_EVAL_CATEGORY } from "@/lib/ai/activity-eval/constants";
import { loadActivityEvalInput } from "@/lib/ai/activity-eval/load";
import { ymdKST } from "@/lib/garmin/utils";
import prisma from "@/lib/prisma";
import { weeklyBaselineEndDate, weeklyReportVars } from "@/lib/report-prompts";
import { PROMPT_KEYS, type PromptKey } from "./definitions";
import { renderPrompt } from "./render";
import { resolvePrompt, resolvePromptTemplate } from "./resolve";
import { activityMismatchError, resolveTrialTarget, type ReportKey, type TrialRequest, type TrialTarget } from "./run-plan";
import { startRun } from "./runs";
import { validatePrompt } from "./validate";
import { PromptActionError } from "./versions";

/** 시험 실행 전용 채널 — 실행 중은 전체 1건이라 채널 하나로 충분 */
export const PROMPT_TRIAL_CHANNEL = "prompt-trial";

interface DraftRow {
  id: string;
  key: PromptKey;
  body: string;
}

function reportVars(key: ReportKey): Record<string, string> {
  return key === "weekly_report" ? weeklyReportVars(weeklyBaselineEndDate()) : {};
}

function nonEmpty(result: string): string {
  if (!result || result.trim().length === 0) throw new Error("어드바이저가 빈 응답을 돌려줬습니다");
  return result;
}

async function runReportTrial(draft: DraftRow, key: ReportKey): Promise<string> {
  const isSystem = draft.key === "system";
  // 리포트 초안은 그 본문을 치환 · 시스템 초안은 리포트 지시문은 사용 중 버전 그대로
  const prompt = isSystem ? (await resolvePrompt(key, reportVars(key))).text : renderPrompt(draft.body, reportVars(key));
  resetSession(PROMPT_TRIAL_CHANNEL);
  const { result } = await askAdvisor(prompt, {
    channel: PROMPT_TRIAL_CHANNEL,
    minTurns: 2,
    ...(isSystem ? { systemOverride: { body: draft.body, versionId: draft.id } } : {}),
  });
  return nonEmpty(result);
}

async function runActivityTrial(draft: DraftRow, activityId: string): Promise<string> {
  const input = await loadActivityEvalInput(activityId);
  if (!input) throw new Error("활동을 찾을 수 없습니다");
  const [full, brief] = await Promise.all([resolvePromptTemplate("activity_eval"), resolvePromptTemplate("activity_eval_brief")]);
  const templates = {
    full: draft.key === "activity_eval" ? draft.body : full.body,
    brief: draft.key === "activity_eval_brief" ? draft.body : brief.body,
  };
  const ctx = buildEvalContext(input, templates);
  // 빌더는 치환 실패 시 코드 기본값으로 조용히 넘어간다 — 시험에선 초안이 안 쓰인 결과를 돌려주면 안 된다
  if (ctx.templateFallback && draft.key !== "system") throw new Error("초안 본문을 치환하지 못했습니다 — 변수를 확인하세요");
  resetSession(PROMPT_TRIAL_CHANNEL);
  const { result } = await askAdvisor(ctx.prompt, {
    channel: PROMPT_TRIAL_CHANNEL,
    minTurns: 0,
    ...(draft.key === "system" ? { systemOverride: { body: draft.body, versionId: draft.id } } : {}),
  });
  return nonEmpty(result);
}

async function findDraft(versionId: string): Promise<DraftRow> {
  const row = await prisma.promptVersion.findUnique({ where: { id: versionId }, select: { id: true, key: true, body: true, status: true } });
  if (!row || !(PROMPT_KEYS as readonly string[]).includes(row.key)) throw new PromptActionError(404, "버전을 찾을 수 없습니다");
  if (row.status !== "draft") throw new PromptActionError(409, "초안만 시험할 수 있습니다 — 사용 중 · 보관 버전은 결과 탭에서 실제 결과를 보세요");
  const key = row.key as PromptKey;
  const { errors } = validatePrompt(key, row.body);
  if (errors.length > 0) throw new PromptActionError(400, "프롬프트 검증을 통과하지 못했습니다", errors);
  return { id: row.id, key, body: row.body };
}

async function assertActivityFits(key: PromptKey, activityId: string): Promise<void> {
  const activity = await prisma.activity.findUnique({ where: { id: activityId }, select: { activityType: true } });
  if (!activity) throw new PromptActionError(404, "활동을 찾을 수 없습니다");
  const mismatch = activityMismatchError(key, activity.activityType);
  if (mismatch) throw new PromptActionError(400, mismatch);
}

export async function startTrial(versionId: string, request: TrialRequest): Promise<{ id: string }> {
  const draft = await findDraft(versionId);
  const resolved = resolveTrialTarget(draft.key, request);
  if (!resolved.ok) throw new PromptActionError(400, resolved.error);
  const { target } = resolved;
  if (target.kind === "activity") await assertActivityFits(draft.key, target.activityId);
  return startRun(
    { kind: "trial", versionId: draft.id, targetKind: target.kind, targetRef: target.kind === "report" ? target.key : target.activityId },
    () => (target.kind === "report" ? runReportTrial(draft, target.key) : runActivityTrial(draft, target.activityId)),
  );
}

export interface ActualResultDTO {
  id: string;
  reportDate: string | null;
  createdAt: string;
  response: string;
}

/**
 * 시험 결과 옆에 둘 같은 대상의 최근 실제 결과 (T4). 리포트 = 그 카테고리의 최신.
 * 활동 평가는 AIAdvice 에 활동 id 가 없어 같은 날짜의 최신 평가 — 하루에 활동이 여럿이면 다른 활동의 평가일 수 있다 (스펙 Known limitations).
 */
export async function findActualResult(target: TrialTarget): Promise<ActualResultDTO | null> {
  let where: { category: string; reportDate?: string };
  if (target.kind === "report") {
    where = { category: target.key };
  } else {
    const activity = await prisma.activity.findUnique({ where: { id: target.activityId }, select: { startTime: true } });
    if (!activity) return null;
    where = { category: ACTIVITY_EVAL_CATEGORY, reportDate: ymdKST(activity.startTime) };
  }
  const row = await prisma.aIAdvice.findFirst({ where, orderBy: { createdAt: "desc" }, select: { id: true, reportDate: true, createdAt: true, response: true } });
  return row ? { id: row.id, reportDate: row.reportDate, createdAt: row.createdAt.toISOString(), response: row.response } : null;
}
