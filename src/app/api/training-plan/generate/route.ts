import { NextResponse } from "next/server";
import { z } from "zod";
import { generateTrainingPlan } from "@/mcp/tools/training-plan";

// M6-1: generate_training_plan MCP 도구를 위한 명시적 승인 진입점.
// AI advisor 는 mutating 도구를 자동 호출하지 못하도록 allowedTools 에서 제외되어 있으므로,
// 사용자가 plan 을 새로 생성하려면 이 API 를 명시적으로 호출해야 함.

const BODY_SCHEMA = z.object({
  weeklyFrequency: z.number().int().min(3).max(5).optional(),
  targetDistance: z.enum(["5K", "10K", "HM", "FM"]).optional(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식")
    .optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = BODY_SCHEMA.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "유효하지 않은 입력", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const result = await generateTrainingPlan(parsed.data);
    const text = result.content[0]?.text ?? "{}";
    const payload = JSON.parse(text);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
