// #552 M19-2 L3: 프롬프트별 AI 결과 조회 조건 — 순수. 키 → AIAdvice 카테고리 · 버전 컬럼, 버전 필터 → where.
import type { Prisma } from "@/generated/prisma/client";
import { ACTIVITY_EVAL_CATEGORY } from "@/lib/ai/activity-eval/constants";
import type { PromptKey } from "./definitions";

/** 시스템 프롬프트 결과에서 뺄 카테고리 — AI 응답이 아닌 기록 (auto-adjust 제안 메시지) */
const NON_AI_CATEGORIES = ["auto_adjust_proposal"] as const;

/** null = 모든 카테고리 (시스템 프롬프트는 모든 응답의 바탕) */
const CATEGORIES: Record<PromptKey, readonly string[] | null> = {
  system: null,
  morning_report: ["morning_report"],
  evening_report: ["evening_report"],
  weekly_report: ["weekly_report"],
  activity_eval: [ACTIVITY_EVAL_CATEGORY],
  activity_eval_brief: [ACTIVITY_EVAL_CATEGORY],
};

export type VersionField = "systemPromptVersionId" | "promptVersionId";

export function versionFieldFor(key: PromptKey): VersionField {
  return key === "system" ? "systemPromptVersionId" : "promptVersionId";
}

export const RESULTS_DEFAULT_LIMIT = 30;
export const RESULTS_MAX_LIMIT = 100;
/** 필터 값에서 "버전 정보 없음" */
export const NO_VERSION = "none";

export interface VersionFilter {
  versionIds: string[];
  includeNone: boolean;
}

/**
 * 요청 필터 (`versions=id,id,none`) → 이 키의 버전만 남긴 필터. 비었으면 전체 (이 키의 모든 버전 + 버전 정보 없음).
 * 러닝 평가 · 기타 운동 평가는 카테고리가 같아서, 다른 키의 버전 id 는 여기서 걸러낸다.
 */
export function resolveVersionFilter(requested: readonly string[], keyVersionIds: readonly string[]): VersionFilter {
  if (requested.length === 0) return { versionIds: [...keyVersionIds], includeNone: true };
  // 요청했지만 이 키에 없는 버전뿐이면 결과 없음 — 전체로 넓히지 않는다 (사전 리뷰 info 1)
  return { versionIds: requested.filter((id) => keyVersionIds.includes(id)), includeNone: requested.includes(NO_VERSION) };
}

export function buildResultsWhere(key: PromptKey, filter: VersionFilter): Prisma.AIAdviceWhereInput {
  const field = versionFieldFor(key);
  const categories = CATEGORIES[key];
  const versionOr: Prisma.AIAdviceWhereInput[] = [
    ...(filter.versionIds.length > 0 ? [{ [field]: { in: filter.versionIds } }] : []),
    ...(filter.includeNone ? [{ [field]: null }] : []),
  ];
  return {
    category: categories ? { in: [...categories] } : { notIn: [...NON_AI_CATEGORIES] },
    // 조건이 하나도 없으면 결과 없음 (빈 OR 는 Prisma 에서 false)
    OR: versionOr,
  };
}

export function parseLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return RESULTS_DEFAULT_LIMIT;
  return Math.min(n, RESULTS_MAX_LIMIT);
}

export interface PickableResult {
  id: string;
  category: string;
  versionId: string | null;
}

/**
 * 나란히 비교 기본 선택 — 최신 결과 + 다른 버전의 최신 결과. 결과는 최신순.
 * 같은 종류 (카테고리) 를 먼저 — 시스템 프롬프트 결과는 리포트 · 평가 · 채팅이 섞인다 (PR #555 Codex P2).
 * 순서: 같은 종류 · 다른 버전 (버전 있음) → 같은 종류 · 다른 버전 → 다른 종류 · 다른 버전 (버전 있음) → 다른 버전 → 바로 이전
 */
export function pickDefaultPair(results: readonly PickableResult[]): string[] {
  const [latest, ...rest] = results;
  if (!latest) return [];
  const otherVersion = (r: PickableResult) => r.versionId !== latest.versionId;
  const sameKind = (r: PickableResult) => r.category === latest.category;
  const versioned = (r: PickableResult) => r.versionId !== null;
  const second =
    rest.find((r) => sameKind(r) && otherVersion(r) && versioned(r)) ??
    rest.find((r) => sameKind(r) && otherVersion(r)) ??
    rest.find((r) => otherVersion(r) && versioned(r)) ??
    rest.find(otherVersion) ??
    rest[0];
  return second ? [latest.id, second.id] : [latest.id];
}
