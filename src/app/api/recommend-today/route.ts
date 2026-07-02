import { NextResponse } from "next/server";
import { recommendTodayWorkout } from "@/mcp/tools/recommend-today-workout";

// /training-plan 페이지의 오늘 workout 카드 데이터 진입점.
// recommendTodayWorkout MCP 도구 응답을 파싱해 JSON 그대로 반환.

export async function GET() {
  try {
    const result = await recommendTodayWorkout();
    const text = result.content[0]?.text ?? "{}";
    const payload = JSON.parse(text);
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[api/recommend-today] 조회 실패:", error);
    return NextResponse.json(
      { error: "오늘 workout 추천 조회 중 서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
