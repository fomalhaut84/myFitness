// #552 M19-2 L3: 프롬프트 버전별 AI 결과 — `versions=id,id,none` (none = 버전 정보 없음) · `limit` (기본 30 · 최대 100). 최신순
import { NextResponse } from "next/server";
import { isPromptKey } from "@/lib/prompts/definitions";
import { promptErrorResponse } from "@/lib/prompts/http";
import { listPromptResults } from "@/lib/prompts/results";
import { parseLimit } from "@/lib/prompts/results-query";

interface Params {
  params: Promise<{ key: string }>;
}

const MAX_FILTER_IDS = 50;

export async function GET(request: Request, { params }: Params) {
  try {
    const { key } = await params;
    if (!isPromptKey(key)) return NextResponse.json({ error: "없는 프롬프트입니다" }, { status: 404 });
    const url = new URL(request.url);
    const versions = (url.searchParams.get("versions") ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0 && v.length <= 64)
      .slice(0, MAX_FILTER_IDS);
    const results = await listPromptResults(key, versions, parseLimit(url.searchParams.get("limit")));
    return NextResponse.json({ results });
  } catch (error) {
    return promptErrorResponse(error, "GET results", "결과를 불러오지 못했습니다");
  }
}
