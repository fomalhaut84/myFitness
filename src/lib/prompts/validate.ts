// #552 R3: 프롬프트 저장 전 검증 — 순수. 저장 · 활성화 · 개선안 수락 모두 통과해야 하고, 편집기는 같은 함수로 즉시 보여 준다.
// DB 에서 고친 프롬프트는 vitest 를 거치지 않으므로 그 역할 (필수 도구 문구) 을 이 검증이 대신한다.
import { ADVISOR_ALLOWED_TOOLS, ADVISOR_EXCLUDED_TOOLS } from "@/lib/ai/advisor-tools";
import { PROMPT_DEFINITIONS, PROMPT_MAX_LENGTH, type PromptKey } from "./definitions";
import { VARIABLE_PATTERN } from "./render";

export interface PromptIssue {
  message: string;
  /** 1부터. 본문 전체에 대한 문제면 없음 */
  line?: number;
}

export interface PromptValidation {
  errors: PromptIssue[];
  warnings: PromptIssue[];
}

const TOOL_PATTERN = /mcp__myfitness__([a-z_]+)/g;
const KNOWN_TOOLS = new Set([...ADVISOR_ALLOWED_TOOLS, ...ADVISOR_EXCLUDED_TOOLS]);

function lineAt(body: string, index: number): number {
  return body.slice(0, index).split("\n").length;
}

function variableIssues(key: PromptKey, body: string): PromptIssue[] {
  const allowed = PROMPT_DEFINITIONS[key].variables.map((v) => v.name);
  const used = [...body.matchAll(VARIABLE_PATTERN)];
  const unknown = used
    .filter((m) => !allowed.includes(m[1]))
    .map((m) => ({
      message:
        allowed.length > 0
          ? `모르는 변수 {{${m[1]}}} — 쓸 수 있는 변수는 ${allowed.map((n) => `{{${n}}}`).join(" · ")} 입니다`
          : `모르는 변수 {{${m[1]}}} — 이 프롬프트는 변수를 쓰지 않습니다`,
      line: lineAt(body, m.index ?? 0),
    }));
  const usedNames = new Set(used.map((m) => m[1]));
  const missing = allowed
    .filter((name) => !usedNames.has(name))
    .map((name) => ({ message: `필수 변수 {{${name}}} 가 없습니다` }));
  return [...unknown, ...missing];
}

function snippetIssues(key: PromptKey, body: string): PromptIssue[] {
  return PROMPT_DEFINITIONS[key].requiredSnippets
    .filter((snippet) => !body.includes(snippet))
    .map((snippet) => ({ message: `필수 문구가 없습니다: ${snippet}` }));
}

function toolWarnings(body: string): PromptIssue[] {
  return [...body.matchAll(TOOL_PATTERN)]
    .filter((m) => !KNOWN_TOOLS.has(m[0]))
    .map((m) => ({
      message: `${m[1]} 는 어드바이저가 쓸 수 없는 도구입니다. 호출되지 않습니다`,
      line: lineAt(body, m.index ?? 0),
    }));
}

export function validatePrompt(key: PromptKey, body: string): PromptValidation {
  if (body.trim().length === 0) {
    return { errors: [{ message: "본문이 비어 있습니다" }], warnings: [] };
  }
  const lengthErrors =
    body.length > PROMPT_MAX_LENGTH
      ? [{ message: `본문이 너무 깁니다 (${body.length.toLocaleString()}자 · 최대 ${PROMPT_MAX_LENGTH.toLocaleString()}자)` }]
      : [];
  return {
    errors: [...lengthErrors, ...variableIssues(key, body), ...snippetIssues(key, body)],
    warnings: toolWarnings(body),
  };
}

/** 필수 문구 · 변수 개수 — 검증 통과 요약 ("필수 문구 8개 모두 있음") 용 */
export function requirementCounts(key: PromptKey): { snippets: number; variables: number } {
  const def = PROMPT_DEFINITIONS[key];
  return { snippets: def.requiredSnippets.length, variables: def.variables.length };
}

/** 편집기 강조용 — 이 키에서 쓸 수 있는 변수인가 */
export function isKnownVariable(key: PromptKey, name: string): boolean {
  return PROMPT_DEFINITIONS[key].variables.some((v) => v.name === name);
}

/** 편집기 강조용 — 경고 대상이 아닌 도구인가 (allowlist + 일부러 뺀 mutating) */
export function isKnownTool(fullName: string): boolean {
  return KNOWN_TOOLS.has(fullName);
}

const SHORT_TOOL_NAMES = ADVISOR_ALLOWED_TOOLS.map((t) => t.replace(/^mcp__myfitness__/, ""));

/** 본문이 언급하는 어드바이저 도구 (접두 `mcp__myfitness__` 유무 무관 — 기본 프롬프트는 둘 다 쓴다) */
export function toolMentions(body: string): string[] {
  return SHORT_TOOL_NAMES.filter((name) => new RegExp(`(?:^|[^a-z_]|mcp__myfitness__)${name}(?![a-z_])`).test(body));
}

/**
 * 사용 중 버전에 있던 도구 언급 중 새 본문에서 빠진 것. #203: 도구 이름이 없으면 Sonnet 이 호출을 건너뛰어
 * 그 도구로 만들던 항목이 빠지거나 부정확해진다 — 필수 문구 밖의 도구도 활성화 전에 확인받는다.
 */
export function removedToolMentions(before: string, after: string): string[] {
  const now = new Set(toolMentions(after));
  return toolMentions(before).filter((name) => !now.has(name));
}

export function removedToolsMessage(names: readonly string[]): string {
  return `사용 중 버전에 있던 도구 언급이 빠졌습니다: ${names.join(" · ")} — 이 도구로 만들던 항목이 빠지거나 부정확해질 수 있습니다`;
}

/** 확인을 받은 시점의 빠진 도구 목록 키 — 목록이 바뀌면 확인이 풀린다 (사전 리뷰 major 1) */
export function removedToolsKey(names: readonly string[]): string {
  return [...names].sort().join(",");
}

export function isRemovedToolsAcknowledged(ackFor: string | null, removed: readonly string[]): boolean {
  return removed.length === 0 || ackFor === removedToolsKey(removed);
}
