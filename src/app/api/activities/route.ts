import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { parseYmdRangeParams } from "@/lib/history/range-params";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const limitRaw = parseInt(url.searchParams.get("limit") ?? "20");
    const offsetRaw = parseInt(url.searchParams.get("offset") ?? "0");
    const limit = Math.min(Number.isNaN(limitRaw) ? 20 : Math.max(1, limitRaw), 100);
    const offset = Number.isNaN(offsetRaw) ? 0 : Math.max(0, offsetRaw);

    // #393 (M15-1): from/to = KST 달력일 inclusive. 없으면 기존 동작.
    const range = parseYmdRangeParams(url.searchParams.get("from"), url.searchParams.get("to"));
    if (!range.ok) {
      return NextResponse.json({ error: range.error }, { status: 400 });
    }

    const where = {
      ...(type && type !== "all" ? { activityType: { contains: type } } : {}),
      ...(range.where ? { startTime: range.where } : {}),
    };

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
