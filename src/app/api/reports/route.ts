import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { generateMorningReport, generateEveningReport } from "@/lib/daily-report";
import { generateWeeklyReport } from "@/lib/weekly-report";
import { todayKSTString, ymdKST, yesterdayKST } from "@/lib/garmin/utils";

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
    const force = body.force === true;
    // 자정 넘김 재생성 등 특정 날짜 record 갱신 시 명시. 미명시면 KST today.
    // 데이터 무결성 가드: KST today/yesterday만 허용.
    // 더 과거 record는 preSync/MCP/프롬프트가 모두 "오늘 기준"이라 과거 컨텍스트 보장 불가 → 차단.
    let reportDate: string | undefined;
    if (typeof body.reportDate === "string") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.reportDate)) {
        return NextResponse.json(
          { error: "reportDate must be YYYY-MM-DD" },
          { status: 400 }
        );
      }
      const today = todayKSTString();
      const yesterday = ymdKST(yesterdayKST());
      if (body.reportDate !== today && body.reportDate !== yesterday) {
        return NextResponse.json(
          {
            error: `reportDate must be ${yesterday} or ${today} (자정 넘김 < 24h 재생성만 허용)`,
          },
          { status: 400 }
        );
      }
      reportDate = body.reportDate;
    }

    let result: string;

    if (type === "morning") {
      result = await generateMorningReport(force, reportDate);
    } else if (type === "evening") {
      result = await generateEveningReport(force, reportDate);
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
