// #440: 활동 AI 평가 컨텍스트 조립 — 순수. 입력 DTO → 섹션 (결측은 생략) → 프롬프트. 러닝 계열은 전체 모드, 그 외는 현행 요약 모드 (3줄).
// 모델이 없는 섹션을 지어내지 않도록 출력 지시는 **포함된 섹션 제목만** 나열한다.
import { isRunningType } from "@/lib/activity/running-types";
import { ACTIVITY_EVAL_BRIEF_PROMPT_DEFAULT, ACTIVITY_EVAL_PROMPT_DEFAULT } from "@/lib/prompts/defaults/activity-eval";
import { renderPrompt } from "@/lib/prompts/render";
import { basicLines, comparisonLines, dynamicsLines, environmentLines, extraLines, intensityLines, recoveryLines, splitLines } from "./sections";
import type { EvalContext, EvalInput, EvalOmitted, EvalSection, EvalSectionId } from "./types";

export const EVAL_SECTION_TITLES: Record<EvalSectionId, string> = {
  basic: "기본 지표",
  splits: "km 스플릿",
  intensity: "강도 분석",
  recovery: "종료 후 회복",
  dynamics: "러닝 다이나믹스",
  extra: "추가 지표",
  environment: "환경",
  comparison: "비교",
};

/** 상세 페이지 순서 */
const FULL_ORDER: readonly EvalSectionId[] = ["basic", "splits", "intensity", "recovery", "dynamics", "extra", "environment", "comparison"];

export const SPLITS_FETCH_FAILED_REASON = "Garmin 스플릿 조회 실패";

function section(id: EvalSectionId, lines: string[]): EvalSection[] {
  return lines.length > 0 ? [{ id, title: EVAL_SECTION_TITLES[id], lines }] : [];
}

function linesFor(id: EvalSectionId, input: EvalInput): string[] {
  switch (id) {
    case "basic":
      return basicLines(input);
    case "splits":
      return input.laps === null ? [] : splitLines(input.laps);
    case "intensity":
      return intensityLines(input);
    case "recovery":
      return recoveryLines(input);
    case "dynamics":
      return dynamicsLines(input);
    case "extra":
      return extraLines(input);
    case "environment":
      return environmentLines(input);
    case "comparison":
      return comparisonLines(input);
  }
}

function renderSections(sections: readonly EvalSection[]): string {
  return sections.map((s) => `## ${s.title}\n${s.lines.map((l) => `- ${l}`).join("\n")}`).join("\n\n");
}

/** #552: 지시문은 DB 활성 버전 (`activity_eval` · `activity_eval_brief`) — 라우트가 `resolvePromptTemplate` 로 넘긴다. 없으면 코드 기본값 */
export interface EvalTemplates {
  full: string;
  brief: string;
}

const DEFAULT_TEMPLATES: EvalTemplates = { full: ACTIVITY_EVAL_PROMPT_DEFAULT, brief: ACTIVITY_EVAL_BRIEF_PROMPT_DEFAULT };

/** 검증을 통과한 템플릿이라 실패하지 않지만, 깨져 있으면 코드 기본값으로 — 평가가 멈추지 않게 (#552 R1) */
function renderOrDefault(template: string, fallback: string, vars: Record<string, string>): string {
  try {
    return renderPrompt(template, vars);
  } catch (error) {
    console.warn("[activity-eval] 프롬프트 템플릿 치환 실패 — 코드 기본값 사용:", error instanceof Error ? error.message : error);
    return renderPrompt(fallback, vars);
  }
}

function fullPrompt(sections: readonly EvalSection[], template: string): string {
  const vars = { sections: renderSections(sections), sectionTitles: sections.map((s) => s.title).join(" · ") };
  return renderOrDefault(template, ACTIVITY_EVAL_PROMPT_DEFAULT, vars);
}

function briefPrompt(sections: readonly EvalSection[], template: string): string {
  return renderOrDefault(template, ACTIVITY_EVAL_BRIEF_PROMPT_DEFAULT, { sections: renderSections(sections) });
}

export function buildEvalContext(input: EvalInput, templates: EvalTemplates = DEFAULT_TEMPLATES): EvalContext {
  if (!isRunningType(input.activity.activityType)) {
    const sections = section("basic", basicLines(input));
    return { mode: "brief", sections, omitted: [], prompt: briefPrompt(sections, templates.brief) };
  }
  const sections = FULL_ORDER.flatMap((id) => section(id, linesFor(id, input)));
  const omitted: EvalOmitted[] = input.laps === null ? [{ id: "splits", title: EVAL_SECTION_TITLES.splits, reason: SPLITS_FETCH_FAILED_REASON }] : [];
  return { mode: "full", sections, omitted, prompt: fullPrompt(sections, templates.full) };
}
