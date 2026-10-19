// #552: 프롬프트 API 공통 — 입력 스키마 · 예상된 실패 (PromptActionError) → { error, issues? } 응답
import { NextResponse } from "next/server";
import { z } from "zod";
import { PROMPT_MAX_LENGTH, PROMPT_NOTE_MAX_LENGTH } from "./definitions";
import { PromptActionError } from "./versions";

/** 검증 (길이 오류 메시지) 은 validatePrompt 가 하고, 여기선 요청 크기만 막는다 */
export const PromptBodySchema = z.string().max(PROMPT_MAX_LENGTH * 2);

export const CreateVersionSchema = z.object({
  body: PromptBodySchema,
  note: z.string().trim().max(PROMPT_NOTE_MAX_LENGTH).optional().transform((v) => (v ? v : null)),
  basedOnId: z.string().min(1).max(64).nullable().optional().transform((v) => v ?? null),
  activate: z.boolean().optional().default(false),
  acknowledgeRemovedTools: z.boolean().optional().default(false),
});

/** 활성화 · 되돌리기 본문 (선택) — 빠진 도구 언급 확인 */
export const SwitchVersionSchema = z
  .object({ acknowledgeRemovedTools: z.boolean().optional().default(false) })
  .nullable()
  .transform((v) => ({ acknowledgeRemovedTools: v?.acknowledgeRemovedTools ?? false }));

export const ValidateSchema = z.object({
  key: z.string(),
  body: PromptBodySchema,
});

export function invalidInput(error: z.ZodError): NextResponse {
  const first = error.issues[0];
  return NextResponse.json({ error: `입력값이 올바르지 않습니다${first ? ` (${first.path.join(".") || "본문"})` : ""}` }, { status: 400 });
}

export function promptErrorResponse(error: unknown, label: string, fallbackMessage: string): NextResponse {
  if (error instanceof PromptActionError) {
    return NextResponse.json(
      { error: error.message, ...(error.issues.length > 0 ? { issues: error.issues } : {}), ...(error.detail ?? {}) },
      { status: error.status },
    );
  }
  console.error(`[api/prompts] ${label} error:`, error instanceof Error ? error.message : error);
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
