// #444 F3: 활동 평가 근거 조립만 (LLM 호출 없음 · 저장 없음) — MCP get_activity_context 가 HTTP 로 부른다.
// #440 evaluate 와 같은 로더 · 빌더. Garmin 스플릿은 웹 프로세스의 세션으로 조회한다.
import { NextResponse } from "next/server";
import { buildEvalContext } from "@/lib/ai/activity-eval/build-context";
import { loadActivityEvalInput } from "@/lib/ai/activity-eval/load";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "활동 id 가 필요합니다" }, { status: 400 });
    }
    const input = await loadActivityEvalInput(id);
    if (!input) {
      return NextResponse.json({ error: "활동을 찾을 수 없습니다" }, { status: 404 });
    }
    const ctx = buildEvalContext(input);
    return NextResponse.json({ mode: ctx.mode, sections: ctx.sections, omitted: ctx.omitted });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[activity-context] failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
