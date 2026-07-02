import { NextResponse } from "next/server";
import { fetchArchivedHistory } from "@/lib/training/plan-history";

// Archived plan 이력 (최신순 20개).
// SSR page (src/app/training-plan/page.tsx) 는 helper 를 직접 호출하지만,
// 이 route 는 향후 client-side revalidation / 외부 소비자용 read-only 진입점.

export async function GET() {
  try {
    const items = await fetchArchivedHistory();
    return NextResponse.json({ items });
  } catch (error) {
    console.error("[api/training-plan/history] 조회 실패:", error);
    return NextResponse.json(
      { error: "plan 이력 조회 중 서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
