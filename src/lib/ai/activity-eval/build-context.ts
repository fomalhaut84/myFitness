// #440: 활동 AI 평가 컨텍스트 조립 — 순수. 입력 DTO → 섹션 (결측은 생략) → 프롬프트. 러닝 계열은 전체 모드, 그 외는 현행 요약 모드 (3줄).
// 모델이 없는 섹션을 지어내지 않도록 출력 지시는 **포함된 섹션 제목만** 나열한다.
import { isRunningType } from "@/lib/activity/running-types";
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

function fullPrompt(sections: readonly EvalSection[]): string {
  const titles = sections.map((s) => s.title).join(" · ");
  return [
    "아래는 서버가 DB 에서 조립한 이 러닝 활동의 전체 지표입니다. 추가 도구 조회 없이 이 데이터만으로 평가하세요. 아래에 없는 항목은 언급하지 마세요 (없다고 말하지도 마세요).",
    "",
    renderSections(sections),
    "",
    "## 출력 형식",
    `- 다음 제목을 이 순서대로 \`### 제목\` 헤딩으로 쓰고 각 1~2문장으로 평가: ${titles}`,
    "- 위 목록에 없는 제목은 만들지 마세요.",
    "- 마지막에 `### 종합` — 잘한 점과 개선점을 3~5문장으로, 이어서 `**다음 러닝**` 으로 시작하는 한 줄 제안.",
    "- 구체적 수치를 인용하고, 강도는 개인 HR 존 (시스템 프롬프트) 기준으로 해석하세요. 비교 섹션의 델타는 음수 페이스 = 빨라짐, 음수 심박 = 낮아짐입니다. 2분 HRR 은 양수 = 회복.",
    "- 마크다운 · 한국어 · \"~하세요\" 체.",
  ].join("\n");
}

function briefPrompt(sections: readonly EvalSection[]): string {
  return ["다음 운동을 평가해줘.", "", renderSections(sections), "", "간단히 3줄 이내로 평가해줘."].join("\n");
}

export function buildEvalContext(input: EvalInput): EvalContext {
  if (!isRunningType(input.activity.activityType)) {
    const sections = section("basic", basicLines(input));
    return { mode: "brief", sections, omitted: [], prompt: briefPrompt(sections) };
  }
  const sections = FULL_ORDER.flatMap((id) => section(id, linesFor(id, input)));
  const omitted: EvalOmitted[] = input.laps === null ? [{ id: "splits", title: EVAL_SECTION_TITLES.splits, reason: SPLITS_FETCH_FAILED_REASON }] : [];
  return { mode: "full", sections, omitted, prompt: fullPrompt(sections) };
}
