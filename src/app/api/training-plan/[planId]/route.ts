import { NextResponse } from "next/server";
import { fetchPlanDetail } from "@/lib/training/plan-detail";

// M7-2: 특정 plan 상세 (active + archived 통합).
// Read-only 진입점. 클라이언트 revalidation 및 외부 소비자용.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ planId: string }> }
) {
  try {
    const { planId } = await params;
    const detail = await fetchPlanDetail(planId);
    if (!detail) {
      return NextResponse.json(
        { error: "plan 을 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    return NextResponse.json(detail);
  } catch (error) {
    console.error("[api/training-plan/[planId]] 조회 실패:", error);
    return NextResponse.json(
      { error: "plan 조회 중 서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
