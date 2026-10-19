// #552 M19-3 G1 · G3: AI 개선안 — 지시문 (메타 프롬프트 · 코드 상수, 관리 대상 아님) 조립 · 응답 파싱 · 검증. 순수.
import { PROMPT_DEFINITIONS, PROMPT_MAX_LENGTH, type PromptKey } from "./definitions";
import { validatePrompt, type PromptValidation } from "./validate";

/** 개선안 1회성 CLI 제한 — 화면 안내 "최대 3분" (T5) */
export const SUGGEST_TIMEOUT_MS = 180_000;

/** 개선안에 넘기는 최근 결과 — 건수 · 건당 길이 상한 (L3) */
export const SUGGEST_RESULT_LIMIT = 5;
export const SUGGEST_RESULT_MAX_LENGTH = 4_000;
export const SUGGEST_RATIONALE_MAX = 8;

export interface SuggestSample {
  label: string;
  response: string;
}

export interface Suggestion {
  body: string;
  rationale: string[];
}

/** 화면에 돌려주는 개선안 — 검증 결과 포함. errors 가 있으면 초안 저장 불가 (G2) */
export interface SuggestionResult extends Suggestion {
  validation: PromptValidation;
}

function clipSample(text: string): string {
  return text.length > SUGGEST_RESULT_MAX_LENGTH ? `${text.slice(0, SUGGEST_RESULT_MAX_LENGTH)}\n…(이하 생략)` : text;
}

function rulesSection(key: PromptKey): string {
  const def = PROMPT_DEFINITIONS[key];
  const vars = def.variables.length > 0 ? def.variables.map((v) => `- {{${v.name}}}: ${v.description}`).join("\n") : "- 없음 — 새 {{변수}} 를 만들지 마세요";
  const snippets = def.requiredSnippets.length > 0 ? def.requiredSnippets.map((s) => `- ${s}`).join("\n") : "- 없음";
  return [`반드시 그대로 남길 변수 (정확히 이 표기):`, vars, "", `반드시 그대로 남길 문구 (도구 호출 지시 — 빠지면 기능이 깨짐):`, snippets].join("\n");
}

export function buildSuggestPrompt(key: PromptKey, body: string, samples: readonly SuggestSample[]): string {
  const def = PROMPT_DEFINITIONS[key];
  const sampleText =
    samples.length > 0 ? samples.map((s, i) => `### 결과 ${i + 1} — ${s.label}\n${clipSample(s.response)}`).join("\n\n") : "(아직 이 프롬프트로 만든 결과가 없습니다)";
  return [
    "당신은 개인 피트니스 AI 어드바이저의 프롬프트를 다듬는 편집자입니다.",
    `아래는 "${def.label}" 프롬프트입니다. 쓰이는 곳: ${def.usage}.`,
    "현재 본문과 이 본문으로 만든 최근 결과를 읽고, 결과의 품질 (정확성 · 구체성 · 읽기 쉬움 · 불필요한 반복) 을 높이도록 본문을 고치세요.",
    "",
    "규칙:",
    "- 본문의 목적과 구조는 유지하고, 결과에서 보인 문제를 고치는 데 집중합니다. 고칠 것이 적으면 적게 고칩니다.",
    "- mcp__myfitness__ 도구 이름 · 호출 지시는 지우거나 이름을 바꾸지 않습니다. 없는 도구를 새로 만들지 않습니다.",
    `- 본문은 ${PROMPT_MAX_LENGTH.toLocaleString("en-US")}자 이하. 한국어.`,
    `- rationale 은 고친 이유 1~${SUGGEST_RATIONALE_MAX}개, 각각 한 문장 — 어떤 결과의 어떤 문제를 무엇으로 고쳤는지.`,
    "",
    rulesSection(key),
    "",
    "응답은 오직 JSON 하나만. 설명 · 마크다운 · 코드펜스 금지:",
    '{"body": "<고친 전체 본문>", "rationale": ["<이유>", ...]}',
    "",
    "## 현재 본문",
    body,
    "",
    "## 최근 결과",
    sampleText,
  ].join("\n");
}

function parseJsonObject(text: string): unknown {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

/** AI 응답 → 개선안. JSON · 코드펜스 · 앞뒤 설명이 붙은 JSON 을 받는다. 형식이 틀리면 null */
export function parseSuggestion(raw: string): Suggestion | null {
  if (!raw) return null;
  const parsed = parseJsonObject(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const { body, rationale } = parsed as { body?: unknown; rationale?: unknown };
  if (typeof body !== "string" || body.trim().length === 0) return null;
  const reasons = Array.isArray(rationale)
    ? rationale
        .filter((r): r is string => typeof r === "string")
        .map((r) => r.trim())
        .filter((r) => r.length > 0)
        .slice(0, SUGGEST_RATIONALE_MAX)
    : [];
  return { body: body.trim(), rationale: reasons };
}

export function evaluateSuggestion(key: PromptKey, suggestion: Suggestion): SuggestionResult {
  return { ...suggestion, validation: validatePrompt(key, suggestion.body) };
}

/** 초안 저장 메모 — 근거 요약 (PROMPT_NOTE_MAX_LENGTH 안). 저장 API 가 다시 자른다 */
export function suggestionNote(rationale: readonly string[], max: number): string {
  const text = rationale.length > 0 ? `AI 개선안: ${rationale.join(" / ")}` : "AI 개선안";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 저장된 응답 (PromptRun.response) → 화면 DTO. 깨졌으면 null */
export function readStoredSuggestion(key: PromptKey, stored: string | null): SuggestionResult | null {
  if (!stored) return null;
  const parsed = parseSuggestion(stored);
  return parsed ? evaluateSuggestion(key, parsed) : null;
}
