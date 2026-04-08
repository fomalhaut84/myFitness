import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { generateMorningReport, generateEveningReport } from "@/lib/daily-report";
import { generateWeeklyReport } from "@/lib/weekly-report";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const date = url.searchParams.get("date");
    const days = parseInt(url.searchParams.get("days") ?? "7");

    const where: Record<string, unknown> = {};

    if (type && type !== "all") {
      where.category = `${type}_report`;
    } else {
      where.category = { in: ["morning_report", "evening_report", "weekly_report"] };
    }

    if (date) {
      where.reportDate = date;
    } else {
      const since = new Date();
      since.setDate(since.getDate() - (Number.isNaN(days) ? 7 : days));
      where.createdAt = { gte: since };
    }

    const reports = await prisma.aIAdvice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        category: true,
        reportDate: true,
        response: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      data: reports.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const type = body.type ?? "morning";

    let result: string;

    if (type === "morning") {
      result = await generateMorningReport();
    } else if (type === "evening") {
      result = await generateEveningReport();
    } else if (type === "weekly") {
      result = await generateWeeklyReport();
    } else {
      return NextResponse.json(
        { error: "type: morning, evening, weekly" },
        { status: 400 }
      );
    }

    return NextResponse.json({ result, type });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
