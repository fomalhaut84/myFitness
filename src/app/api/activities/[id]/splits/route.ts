import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { fetchActivitySplits } from "@/lib/garmin/activity-splits";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: PageProps) {
  try {
    const { id } = await params;

    // DB에서 garminId 조회
    const activity = await prisma.activity.findUnique({
      where: { id },
      select: { garminId: true },
    });

    if (!activity) {
      return NextResponse.json({ error: "활동을 찾을 수 없습니다" }, { status: 404 });
    }

    // #440: Garmin API 호출은 AI 평가 로더와 공용 함수로
    const laps = await fetchActivitySplits(activity.garminId);
    return NextResponse.json({ data: laps });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
