// #440: 활동 AI 평가 — 클라이언트는 activityId 만 보내고, 서버가 상세 페이지 지표 전체를 조립해 어드바이저에 넘긴다.
// 평가 전용 채널을 매번 새 세션으로 — `/ai` 채팅 세션 (channel "web") 과 섞이지 않게.
import { NextResponse } from "next/server";
import { ADVISOR_MODEL, askAdvisor, resetSession } from "@/lib/ai/claude-advisor";
import { buildEvalContext } from "@/lib/ai/activity-eval/build-context";
import { loadActivityEvalInput } from "@/lib/ai/activity-eval/load";
import { ACTIVITY_EVAL_CATEGORY, ACTIVITY_EVAL_CHANNEL } from "@/lib/ai/activity-eval/constants";
import prisma from "@/lib/prisma";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: Params) {
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

    // 컨텍스트를 프롬프트에 다 넣으므로 도구 호출을 요구하지 않는다 (minTurns 0 → 재시도 없음)
    resetSession(ACTIVITY_EVAL_CHANNEL);
    const { result, duration_ms } = await askAdvisor(ctx.prompt, { channel: ACTIVITY_EVAL_CHANNEL, minTurns: 0 });
    if (!result || result.trim().length === 0) {
      throw new Error("어드바이저가 빈 응답을 돌려줬습니다");
    }

    await prisma.aIAdvice.create({
      data: { category: ACTIVITY_EVAL_CATEGORY, reportDate: input.activity.ymd, prompt: ctx.prompt, response: result },
    });

    return NextResponse.json({
      result,
      mode: ctx.mode,
      sections: ctx.sections.map((s) => ({ id: s.id, title: s.title })),
      omitted: ctx.omitted,
      model: ADVISOR_MODEL,
      duration_ms,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[activity-eval] failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
