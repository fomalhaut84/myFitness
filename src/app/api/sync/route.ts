import { NextResponse } from "next/server";
import { syncAll, type DataType } from "@/lib/garmin/sync";

const DEFAULT_DAYS = 3;

const VALID_DATA_TYPES: DataType[] = [
  "daily_stats",
  "activities",
  "sleep",
  "heart_rate",
  "body_composition",
];

/** "YYYY-MM-DD" 문자열을 로컬 midnight Date로 파싱. 무효하면 null. */
function parseLocalDate(dateStr: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;

  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));

  // 파싱 결과가 입력과 일치하는지 검증 (2월 30일 등 방지)
  if (
    date.getFullYear() !== Number(y) ||
    date.getMonth() !== Number(m) - 1 ||
    date.getDate() !== Number(d)
  ) {
    return null;
  }

  return date;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    let endDate: Date;
    if (body.endDate) {
      const parsed = parseLocalDate(body.endDate);
      if (!parsed) {
        return NextResponse.json(
          { error: `유효하지 않은 날짜: ${body.endDate} (YYYY-MM-DD 형식)` },
          { status: 400 }
        );
      }
      endDate = parsed;
    } else {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      d.setHours(0, 0, 0, 0);
      endDate = d;
    }

    let startDate: Date;
    if (body.startDate) {
      const parsed = parseLocalDate(body.startDate);
      if (!parsed) {
        return NextResponse.json(
          { error: `유효하지 않은 날짜: ${body.startDate} (YYYY-MM-DD 형식)` },
          { status: 400 }
        );
      }
      startDate = parsed;
    } else {
      const d = new Date();
      d.setDate(d.getDate() - DEFAULT_DAYS);
      d.setHours(0, 0, 0, 0);
      startDate = d;
    }

    const dataTypes = body.dataTypes
      ? (body.dataTypes as string[]).filter((t): t is DataType =>
          VALID_DATA_TYPES.includes(t as DataType)
        )
      : undefined;

    const results = await syncAll({ startDate, endDate, dataTypes });

    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
