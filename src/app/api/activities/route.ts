import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 100);
    const offset = parseInt(url.searchParams.get("offset") ?? "0");

    const where = type && type !== "all"
      ? { activityType: { contains: type } }
      : {};

    const [activities, total] = await Promise.all([
      prisma.activity.findMany({
        where,
        orderBy: { startTime: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          name: true,
          activityType: true,
          startTime: true,
          duration: true,
          distance: true,
          avgPace: true,
          avgHR: true,
          calories: true,
        },
      }),
      prisma.activity.count({ where }),
    ]);

    return NextResponse.json({
      data: activities.map((a) => ({
        ...a,
        startTime: a.startTime.toISOString(),
      })),
      total,
      limit,
      offset,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
