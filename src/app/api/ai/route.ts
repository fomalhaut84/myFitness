import { NextResponse } from "next/server";
import { askAdvisor, resetSession, getSessionId } from "@/lib/ai/claude-advisor";
import prisma from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt = body.prompt;

    // 세션 초기화 명령
    if (body.action === "reset") {
      resetSession();
      return NextResponse.json({ result: "세션이 초기화되었습니다.", sessionId: null });
    }

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "prompt 필드가 필요합니다" },
        { status: 400 }
      );
    }

    const { result, sessionId, duration_ms } = await askAdvisor(prompt);

    // AI 조언 이력 저장
    await prisma.aIAdvice.create({
      data: {
        category: body.category ?? "general",
        prompt,
        response: result,
      },
    });

    return NextResponse.json({
      result,
      sessionId,
      duration_ms,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ sessionId: getSessionId() });
}
