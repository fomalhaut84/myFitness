import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const reports = await prisma.aIAdvice.findMany({
      where: { category: "weekly_report" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
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

export async function POST() {
  try {
    const { generateWeeklyReport } = await import("@/lib/weekly-report");
    const result = await generateWeeklyReport();
    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
