import { NextResponse } from "next/server";
import { withReauth } from "@/lib/garmin/client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: PageProps) {
  try {
    const { id } = await params;

    // DB에서 garminId 조회
    const prisma = (await import("@/lib/prisma")).default;
    const activity = await prisma.activity.findUnique({
      where: { id },
      select: { garminId: true },
    });

    if (!activity) {
      return NextResponse.json({ error: "활동을 찾을 수 없습니다" }, { status: 404 });
    }

    // Garmin API에서 splits 조회
    const splits = await withReauth(async (client) => {
      return client.get<{ lapDTOs: unknown[] }>(
        `https://connectapi.garmin.com/activity-service/activity/${activity.garminId}/splits`
      );
    });

    return NextResponse.json({ data: splits.lapDTOs ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
