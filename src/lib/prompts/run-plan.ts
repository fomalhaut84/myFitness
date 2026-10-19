// #552 M19-3 T3: 시험 실행 대상 판정 · 실행 job 정리 기준 — 순수 (prisma 없음). 실행은 trial.ts · suggest.ts.
import { isRunningType } from "@/lib/activity/running-types";
import type { PromptKey } from "./definitions";

export type RunKind = "suggest" | "trial";
export type RunStatus = "running" | "done" | "failed";

export const REPORT_KEYS = ["morning_report", "evening_report", "weekly_report"] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export type TrialTarget = { kind: "report"; key: ReportKey } | { kind: "activity"; activityId: string };

/** 시험 요청 — `target` 은 시스템 프롬프트 초안만 고른다 (리포트 키 · 평가 키는 대상이 정해져 있다) */
export interface TrialRequest {
  target?: ReportKey | "activity";
  activityId?: string;
}

export type TargetResult = { ok: true; target: TrialTarget } | { ok: false; error: string };

/** 시스템 프롬프트 초안의 기본 대상 — 도구를 가장 많이 쓰는 리포트 (T3) */
export const SYSTEM_DEFAULT_TARGET: ReportKey = "morning_report";

/**
 * 실행 중으로 남은 job 을 실패로 정리하는 여유 — 기준은 어드바이저 최대 소요 (`getAskAdvisorMaxTotalBudgetMs`, 재시도 env 반영) + 이 여유.
 * 고정 10분이면 재시도 3회+ 에서 살아 있는 시험을 실패로 바꾸고 두 번째 CLI 를 띄운다 (사전 리뷰 info 1)
 */
export const RUN_STALE_MARGIN_MS = 2 * 60_000;

/** 개선안 · 시험 결과 응답 보관 상한 */
export const RUN_RESPONSE_MAX_LENGTH = 40_000;
export const RUN_ERROR_MAX_LENGTH = 1_000;

function isReportKey(key: string): key is ReportKey {
  return (REPORT_KEYS as readonly string[]).includes(key);
}

function activityTarget(activityId: string | undefined): TargetResult {
  const id = activityId?.trim();
  if (!id) return { ok: false, error: "시험할 활동을 고르세요" };
  return { ok: true, target: { kind: "activity", activityId: id } };
}

export function resolveTrialTarget(key: PromptKey, request: TrialRequest): TargetResult {
  if (isReportKey(key)) return { ok: true, target: { kind: "report", key } };
  if (key === "activity_eval" || key === "activity_eval_brief") return activityTarget(request.activityId);
  // system
  const target = request.target ?? SYSTEM_DEFAULT_TARGET;
  return target === "activity" ? activityTarget(request.activityId) : { ok: true, target: { kind: "report", key: target } };
}

/** 저장된 시험 기록 (targetKind · targetRef) → 대상. 개선안 · 깨진 기록은 null */
export function trialTargetOf(run: { kind: string; targetKind: string | null; targetRef: string | null }): TrialTarget | null {
  if (run.kind !== "trial" || !run.targetRef) return null;
  if (run.targetKind === "activity") return { kind: "activity", activityId: run.targetRef };
  if (run.targetKind === "report" && isReportKey(run.targetRef)) return { kind: "report", key: run.targetRef };
  return null;
}

/** 이 활동을 평가할 때 쓰는 지시문 키 — 빌더 (`buildEvalContext`) 의 모드 판정과 같은 기준 */
export function evalKeyForActivity(activityType: string): "activity_eval" | "activity_eval_brief" {
  return isRunningType(activityType) ? "activity_eval" : "activity_eval_brief";
}

/**
 * 평가 지시문 초안을 다른 종류 활동에 시험하면 빌더가 다른 지시문을 골라 초안이 쓰이지 않는다 → 막는다.
 * 시스템 프롬프트 초안은 어떤 활동이든 된다 (null = 통과).
 */
export function activityMismatchError(key: PromptKey, activityType: string): string | null {
  if (key !== "activity_eval" && key !== "activity_eval_brief") return null;
  if (evalKeyForActivity(activityType) === key) return null;
  return key === "activity_eval" ? "러닝 평가 지시문은 러닝 활동으로만 시험할 수 있습니다" : "기타 운동 평가 지시문은 러닝이 아닌 활동으로만 시험할 수 있습니다";
}

/** 이 시각 이전에 시작해 아직 running 인 job 은 끊긴 것으로 본다. `maxRunMs` = 실행 1건의 최대 소요 */
export function staleCutoff(maxRunMs: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - maxRunMs - RUN_STALE_MARGIN_MS);
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
