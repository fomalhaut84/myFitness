import { NextResponse } from "next/server";
import { askAdvisor } from "@/lib/ai/claude-advisor";
import prisma from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt = body.prompt;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "prompt 필드가 필요합니다" },
        { status: 400 }
      );
    }

    const { result, duration_ms } = await askAdvisor(prompt);

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
      duration_ms,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
