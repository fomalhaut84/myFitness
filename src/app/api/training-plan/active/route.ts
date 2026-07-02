import { NextResponse } from "next/server";
import { getActiveTrainingPlan } from "@/mcp/tools/training-plan";

// /training-plan 페이지의 SSR/CSR 데이터 진입점.
// getActiveTrainingPlan MCP 도구 응답을 파싱해 JSON 그대로 반환.

export async function GET() {
  try {
    const result = await getActiveTrainingPlan();
    const text = result.content[0]?.text ?? "{}";
    const payload = JSON.parse(text);
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[api/training-plan/active] 조회 실패:", error);
    return NextResponse.json(
      { error: "active plan 조회 중 서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
