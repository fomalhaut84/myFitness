// #552 M19-3 G1: AI 개선안 받기 — job 시작 후 runId 반환 (`GET /api/prompts/runs/[id]` 폴링). 실행 중이 있으면 409
import { NextResponse } from "next/server";
import { isPromptKey } from "@/lib/prompts/definitions";
import { promptErrorResponse } from "@/lib/prompts/http";
import { startSuggestion } from "@/lib/prompts/suggest";

interface Params {
  params: Promise<{ key: string }>;
}

export async function POST(_request: Request, { params }: Params) {
  try {
    const { key } = await params;
    if (!isPromptKey(key)) return NextResponse.json({ error: "없는 프롬프트입니다" }, { status: 404 });
    const run = await startSuggestion(key);
    return NextResponse.json({ runId: run.id }, { status: 202 });
  } catch (error) {
    return promptErrorResponse(error, "POST suggest", "개선안 받기를 시작하지 못했습니다");
  }
}
