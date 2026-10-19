// #552 A1: 프롬프트 목록 — 키별 사용 중 버전 · 초안 수 · 코드 기본값 갱신 여부. 조회 전에 코드 기본값을 맞춘다 (R2 · idempotent)
import { NextResponse } from "next/server";
import { PROMPT_DEFINITIONS } from "@/lib/prompts/definitions";
import { promptErrorResponse } from "@/lib/prompts/http";
import { ensureDefaults } from "@/lib/prompts/resolve";
import { listPromptSummaries } from "@/lib/prompts/versions";

export async function GET() {
  try {
    await ensureDefaults();
    const summaries = await listPromptSummaries();
    const prompts = summaries.map((s) => {
      const def = PROMPT_DEFINITIONS[s.key];
      return { ...s, label: def.label, group: def.group, usage: def.usage };
    });
    return NextResponse.json({ prompts });
  } catch (error) {
    return promptErrorResponse(error, "GET", "프롬프트 목록을 불러오지 못했습니다");
  }
}
