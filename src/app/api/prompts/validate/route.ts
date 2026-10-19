// #552 A6: 저장 없이 검증만 — 편집기는 같은 validatePrompt 를 클라이언트에서도 돌리지만, 서버 기준을 확인할 때 쓴다
import { NextResponse } from "next/server";
import { isPromptKey } from "@/lib/prompts/definitions";
import { invalidInput, promptErrorResponse, ValidateSchema } from "@/lib/prompts/http";
import { validatePrompt } from "@/lib/prompts/validate";

export async function POST(request: Request) {
  try {
    const parsed = ValidateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidInput(parsed.error);
    if (!isPromptKey(parsed.data.key)) return NextResponse.json({ error: "없는 프롬프트입니다" }, { status: 404 });
    return NextResponse.json(validatePrompt(parsed.data.key, parsed.data.body));
  } catch (error) {
    return promptErrorResponse(error, "POST validate", "검증하지 못했습니다");
  }
}
