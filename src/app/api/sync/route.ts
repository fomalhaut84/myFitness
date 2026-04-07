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

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    const endDate = body.endDate
      ? new Date(body.endDate)
      : (() => {
          const d = new Date();
          d.setDate(d.getDate() - 1);
          d.setHours(0, 0, 0, 0);
          return d;
        })();

    const startDate = body.startDate
      ? new Date(body.startDate)
      : (() => {
          const d = new Date();
          d.setDate(d.getDate() - DEFAULT_DAYS);
          d.setHours(0, 0, 0, 0);
          return d;
        })();

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
