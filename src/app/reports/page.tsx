import prisma from "@/lib/prisma";
import ReportsClient, { type Report } from "./reports-client";

// cron이 매일 새 리포트를 생성하므로 빌드 시점 스냅샷 prerender 금지.
export const dynamic = "force-dynamic";

const PAGE_LIMIT = 14;

async function fetchInitialPage(): Promise<{
  initialReports: Report[];
  initialNextCursor: string | null;
}> {
  const rows = await prisma.aIAdvice.findMany({
    where: {
      category: { in: ["morning_report", "evening_report", "weekly_report"] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_LIMIT + 1,
    select: {
      id: true,
      category: true,
      reportDate: true,
      response: true,
      createdAt: true,
    },
  });

  const hasMore = rows.length > PAGE_LIMIT;
  const sliced = hasMore ? rows.slice(0, PAGE_LIMIT) : rows;
  const initialReports: Report[] = sliced.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }));
  // cursor 복합키 (createdAt|id) — API와 동일 형식.
  const initialNextCursor =
    hasMore && initialReports.length > 0
      ? `${initialReports[initialReports.length - 1].createdAt}|${initialReports[initialReports.length - 1].id}`
      : null;

  return { initialReports, initialNextCursor };
}

export default async function ReportsPage() {
  const { initialReports, initialNextCursor } = await fetchInitialPage();
  return (
    <ReportsClient
      initialReports={initialReports}
      initialNextCursor={initialNextCursor}
    />
  );
}
