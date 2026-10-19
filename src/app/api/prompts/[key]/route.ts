// #552 A2: 프롬프트 상세 — 정의 (변수 · 필수 문구 · 사용처) + 버전 목록 (본문 포함 · 최신순)
import { NextResponse } from "next/server";
import { isPromptKey, PROMPT_DEFINITIONS } from "@/lib/prompts/definitions";
import { promptErrorResponse } from "@/lib/prompts/http";
import { listVersions } from "@/lib/prompts/versions";

interface Params {
  params: Promise<{ key: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { key } = await params;
    if (!isPromptKey(key)) return NextResponse.json({ error: "없는 프롬프트입니다" }, { status: 404 });
    const { defaultBody: _defaultBody, ...definition } = PROMPT_DEFINITIONS[key];
    return NextResponse.json({ definition, versions: await listVersions(key) });
  } catch (error) {
    return promptErrorResponse(error, "GET [key]", "프롬프트를 불러오지 못했습니다");
  }
}
