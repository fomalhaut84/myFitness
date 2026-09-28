// #455 F1: 개인 기록 API — MCP get_personal_records 가 HTTP 로 부른다 (records.ts 는 prisma + 히스토리 집계를 끌어오므로 MCP 번들에 넣지 않는다).
// GET /api/history/records → PersonalRecords (전 기간 [lowerBound, today]) · /trends 와 같은 메모리 캐시.
import { NextResponse } from "next/server";
import { todayKSTString } from "@/lib/garmin/utils";
import { getCachedLowerBound, getCachedPersonalRecords } from "@/lib/history/cache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = { lowerBound: await getCachedLowerBound(), today: todayKSTString() };
    const records = await getCachedPersonalRecords(ctx);
    return NextResponse.json({ ...ctx, ...records });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[history-records] failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
