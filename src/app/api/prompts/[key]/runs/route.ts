// #552 M19-3 T4: 이 프롬프트의 개선안 · 시험 실행 기록 (최신순) — 화면이 버전별로 묶는다
import { NextResponse } from "next/server";
import { isPromptKey } from "@/lib/prompts/definitions";
import { promptErrorResponse } from "@/lib/prompts/http";
import { listRuns } from "@/lib/prompts/runs";

interface Params {
  params: Promise<{ key: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { key } = await params;
    if (!isPromptKey(key)) return NextResponse.json({ error: "없는 프롬프트입니다" }, { status: 404 });
    return NextResponse.json({ runs: await listRuns(key) });
  } catch (error) {
    return promptErrorResponse(error, "GET runs", "실행 기록을 불러오지 못했습니다");
  }
}
