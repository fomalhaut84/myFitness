import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// M8: active plan 취소 (archived 로 이동, 후속 plan 없음).
// POST /api/training-plan/[planId]/cancel

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ planId: string }> }
) {
  try {
    const { planId } = await params;
    const plan = await prisma.trainingPlan.findUnique({
      where: { id: planId },
      select: { status: true },
    });
    if (!plan) {
      return NextResponse.json(
        { error: "plan 을 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    if (plan.status !== "active") {
      return NextResponse.json(
        { error: "이미 archived 인 plan 은 취소할 수 없습니다." },
        { status: 409 }
      );
    }
    const updated = await prisma.trainingPlan.update({
      where: { id: planId },
      data: { status: "archived" },
      select: { id: true, status: true },
    });
    return NextResponse.json({ plan: updated });
  } catch (error) {
    console.error("[api/training-plan/[planId]/cancel] 실패:", error);
    return NextResponse.json(
      { error: "plan 취소 중 서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
