import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { generateMorningReport, generateEveningReport } from "@/lib/daily-report";
import { generateWeeklyReport } from "@/lib/weekly-report";
import { todayKSTString, ymdKST, yesterdayKST } from "@/lib/garmin/utils";

const DEFAULT_LIMIT = 14;
const MAX_LIMIT = 50;

/** cursor 형식: "<createdAt ISO>|<id>". orderBy [createdAt desc, id desc] 와 일치. */
function parseCursor(cursor: string): { createdAt: Date; id: string } | null {
  const idx = cursor.indexOf("|");
  if (idx <= 0 || idx === cursor.length - 1) return null;
  const tsStr = cursor.slice(0, idx);
  const id = cursor.slice(idx + 1);
  const createdAt = new Date(tsStr);
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}

function buildNextCursor(rows: { createdAt: string; id: string }[]): string | null {
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1];
  return `${last.createdAt}|${last.id}`;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const date = url.searchParams.get("date");
    const cursor = url.searchParams.get("cursor");
    const limitRaw = parseInt(url.searchParams.get("limit") ?? `${DEFAULT_LIMIT}`, 10);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number.isNaN(limitRaw) ? DEFAULT_LIMIT : limitRaw)
    );
    const days = parseInt(url.searchParams.get("days") ?? "7", 10);

    const baseWhere: Record<string, unknown> = {};

    if (type && type !== "all") {
      baseWhere.category = `${type}_report`;
    } else {
      baseWhere.category = { in: ["morning_report", "evening_report", "weekly_report"] };
    }

    // cursor 복합키 (createdAt|id): orderBy [createdAt desc, id desc] 와 일치하는
    // 키셋 페이지네이션. 동일 createdAt 다건이 페이지 경계에 걸려도 누락/중복 없음.
    let where: Record<string, unknown> = baseWhere;
    // 우선순위: date(단일 날짜) > cursor(페이지네이션) > days(후방 호환)
    if (date) {
      where = { ...baseWhere, reportDate: date };
    } else if (cursor) {
      const parsed = parseCursor(cursor);
      if (!parsed) {
        return NextResponse.json(
          { error: "cursor must be '<ISO 8601 datetime>|<id>'" },
          { status: 400 }
        );
      }
      where = {
        AND: [
          baseWhere,
          {
            OR: [
              { createdAt: { lt: parsed.createdAt } },
              { createdAt: parsed.createdAt, id: { lt: parsed.id } },
            ],
          },
        ],
      };
    } else {
      const since = new Date();
      since.setDate(since.getDate() - (Number.isNaN(days) ? 7 : days));
      where = { ...baseWhere, createdAt: { gte: since } };
    }

    // take: limit+1로 hasMore 판단 (count 쿼리 회피)
    const rows = await prisma.aIAdvice.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        category: true,
        reportDate: true,
        response: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const data = sliced.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }));
    const nextCursor = hasMore ? buildNextCursor(data) : null;

    return NextResponse.json({ data, nextCursor });
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
      // reportDate 명시는 force=true + morning/evening에서만 허용 (재생성 전용)
      if (!force || (type !== "morning" && type !== "evening")) {
        return NextResponse.json(
          {
            error:
              "reportDate is only allowed with force=true and type in {morning, evening}",
          },
          { status: 400 }
        );
      }
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
