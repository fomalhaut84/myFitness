import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import SleepDetailClient from "./sleep-detail-client";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ date: string }>;
}

export default async function SleepDetailPage({ params }: PageProps) {
  const { date: dateStr } = await params;

  // YYYY-MM-DD 검증
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) notFound();

  const [y, m, d] = match.slice(1).map(Number);
  const targetDate = new Date(y, m - 1, d);
  targetDate.setHours(0, 0, 0, 0);

  // 2월 31일 등 무효 날짜 방지
  if (targetDate.getFullYear() !== y || targetDate.getMonth() !== m - 1 || targetDate.getDate() !== d) {
    notFound();
  }

  const record = await prisma.sleepRecord.findUnique({
    where: { date: targetDate },
  });

  if (!record) notFound();

  return (
    <div>
      <Link
        href="/sleep"
        className="inline-flex items-center gap-1.5 text-[13px] text-sub hover:text-bright transition-colors mb-6"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 12L6 8l4-4" />
        </svg>
        수면 목록
      </Link>

      <SleepDetailClient
        record={{
          date: dateStr,
          totalSleep: record.totalSleep,
          deepSleep: record.deepSleep,
          lightSleep: record.lightSleep,
          remSleep: record.remSleep,
          awakeDuration: record.awakeDuration,
          sleepScore: record.sleepScore,
          sleepStart: record.sleepStart.toISOString(),
          sleepEnd: record.sleepEnd.toISOString(),
          avgSpO2: record.avgSpO2,
          avgRespiration: record.avgRespiration,
          lowestRespiration: record.lowestRespiration,
          highestRespiration: record.highestRespiration,
          avgSleepStress: record.avgSleepStress,
          bodyBatteryChange: record.bodyBatteryChange,
          restingHR: record.restingHR,
          hrvOvernight: record.hrvOvernight,
          sleepScoreDetails: record.sleepScoreDetails as Record<string, unknown> | null,
        }}
      />
    </div>
  );
}
