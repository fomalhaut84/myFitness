import { NextResponse } from "next/server";
import { z } from "zod";
import { generateTrainingPlan } from "@/mcp/tools/training-plan";

// M6-1: generate_training_plan MCP 도구를 위한 명시적 승인 진입점.
// AI advisor 는 mutating 도구를 자동 호출하지 못하도록 allowedTools 에서 제외되어 있으므로,
// 사용자가 plan 을 새로 생성하려면 이 API 를 명시적으로 호출해야 함.

const BODY_SCHEMA = z.object({
  weeklyFrequency: z.number().int().min(3).max(5).optional(),
  // M11 Phase 1 (#222): weekCount 4~24 (기본 4).
  weekCount: z.number().int().min(4).max(24).optional(),
  // M11 Phase 2 (#232) + Phase 2-b (#236): 목표 유형 + 페이로드.
  goalType: z.enum(["distance", "time", "endurance", "weight_loss"]).optional(),
  targetDistance: z.enum(["5K", "10K", "HM", "FM"]).optional(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식")
    .optional(),
  timeGoal: z
    .object({
      distance: z.enum(["5K", "10K", "HM", "FM"]),
      targetTimeSec: z.number().int().positive(),
      targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식"),
    })
    .optional(),
  enduranceGoal: z
    .object({
      targetLongRunKm: z.number().positive(),
      targetDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식")
        .optional(),
    })
    .optional(),
  weightLossGoal: z
    .object({
      intensityMode: z.enum(["light", "standard", "intense"]),
    })
    .optional(),
});

// generateTrainingPlan 이 명시적으로 throw 하는 사용자 입력 관련 오류 시그니처.
// (weekCount 범위 / targetDate 형식 / targetDistance 누락 / 마지막 주 창 밖 / goalType 별 페이로드)
function isUserInputError(msg: string): boolean {
  return (
    msg.includes("유효하지 않은 targetDate") ||
    msg.includes("targetDate 를 지정하려면") ||
    msg.includes("targetDate 는 마지막 주 창") ||
    msg.includes("weekCount 는") ||
    msg.includes("유효하지 않은 weekCount") ||
    msg.includes("goalType 은") ||
    msg.includes("time 목표") ||
    msg.includes("endurance 목표") ||
    msg.includes("weight_loss 목표")
  );
}

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
    if (isUserInputError(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("[api/training-plan/generate] 예상치 못한 오류:", error);
    return NextResponse.json(
      { error: "plan 생성 중 서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
