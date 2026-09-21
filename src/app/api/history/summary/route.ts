// #393 (M15-1): 히스토리 요약 API. 서버 컴포넌트는 lib 을 직접 호출하고, 이 route 는 클라이언트 지표 전환용.
// GET /api/history/summary?granularity=day|week|month|year&from=YYYY-MM-DD&to=YYYY-MM-DD&metrics=a,b
import { NextResponse } from "next/server";
import { getCachedHistorySummary, getCachedLowerBound } from "@/lib/history/cache";
import { validateSummaryParams } from "@/lib/history/summary";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const validated = await validateSummaryParams(
      {
        granularity: url.searchParams.get("granularity"),
        from: url.searchParams.get("from"),
        to: url.searchParams.get("to"),
        metrics: url.searchParams.get("metrics"),
      },
      getCachedLowerBound,
    );
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    // #394: 메모리 캐시 경유 (#393 F12 — 프로덕션 웜 1.09s > 목표 1s). 키·무효화 규칙은 cache-core.ts
    const summary = await getCachedHistorySummary(validated.params, {
      lowerBound: validated.lowerBound,
      today: validated.today,
    });
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
