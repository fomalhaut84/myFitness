import { NextRequest, NextResponse } from "next/server";
import { getActiveReportJob } from "@/lib/report-job";

/**
 * M#191: 프론트 mount 시 진행중 job 조회. 있으면 SSE 재개.
 *
 * Query: ?category=morning_report&reportDate=2026-07-08
 * Response: { job: ReportJob | null }
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const category = request.nextUrl.searchParams.get("category");
    const reportDate = request.nextUrl.searchParams.get("reportDate");
    if (!category || !reportDate) {
      return NextResponse.json(
        { error: "category, reportDate 필요" },
        { status: 400 },
      );
    }
    const job = await getActiveReportJob({ category, reportDate });
    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
