import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import ActivityDetail from "@/components/activity/ActivityDetail";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ActivityDetailPage({ params }: PageProps) {
  const { id } = await params;

  const activity = await prisma.activity.findUnique({
    where: { id },
    select: {
      name: true,
      activityType: true,
      startTime: true,
      duration: true,
      distance: true,
      calories: true,
      avgHR: true,
      maxHR: true,
      avgPace: true,
      avgSpeed: true,
      elevationGain: true,
      trainingEffect: true,
      vo2maxEstimate: true,
    },
  });

  if (!activity) {
    notFound();
  }

  return (
    <div>
      <Link
        href="/activities"
        className="inline-flex items-center gap-1.5 text-[13px] text-sub hover:text-bright transition-colors mb-6"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 12L6 8l4-4" />
        </svg>
        활동 목록
      </Link>

      <ActivityDetail
        {...activity}
        startTime={activity.startTime.toISOString()}
      />
    </div>
  );
}
