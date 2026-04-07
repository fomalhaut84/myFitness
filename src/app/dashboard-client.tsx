"use client";

import SummaryCard from "@/components/dashboard/SummaryCard";
import WeeklyChart from "@/components/dashboard/WeeklyChart";
import RecentActivities from "@/components/dashboard/RecentActivities";

interface DaySummary {
  steps: number | null;
  restingHR: number | null;
  sleepScore: number | null;
  bodyBattery: number | null;
}

interface DataPoint {
  date: string;
  value: number | null;
}

interface Activity {
  id: string;
  name: string;
  activityType: string;
  startTime: string;
  duration: number;
  distance: number | null;
  avgPace: number | null;
  calories: number | null;
}

interface DashboardClientProps {
  today: DaySummary;
  yesterday: DaySummary;
  weeklySteps: DataPoint[];
  weeklyHR: DataPoint[];
  recentActivities: Activity[];
}

export default function DashboardClient({
  today,
  yesterday,
  weeklySteps,
  weeklyHR,
  recentActivities,
}: DashboardClientProps) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
  const dayNames = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-1">대시보드</h1>
        <p className="text-dim text-sm">
          {dateStr} {dayNames[now.getDay()]}
        </p>
      </div>

      {/* 오늘 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <SummaryCard
          label="걸음 수"
          value={today.steps}
          prevValue={yesterday.steps}
          icon={
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="10" cy="3.5" r="2" />
              <path d="M7 8.5l3 2 3-2M10 10.5v4M7 18l3-3.5 3 3.5" />
            </svg>
          }
        />
        <SummaryCard
          label="안정시 심박"
          value={today.restingHR}
          unit="bpm"
          prevValue={yesterday.restingHR}
          invertDelta
          icon={
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 17s-7-4.35-7-8.5A4 4 0 0 1 10 5.5a4 4 0 0 1 7 3c0 4.15-7 8.5-7 8.5z" />
            </svg>
          }
        />
        <SummaryCard
          label="수면 점수"
          value={today.sleepScore}
          prevValue={yesterday.sleepScore}
          icon={
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16.5 11a7 7 0 1 1-8.5-6.8A5.5 5.5 0 0 0 16.5 11z" />
            </svg>
          }
        />
        <SummaryCard
          label="바디배터리"
          value={today.bodyBattery}
          prevValue={yesterday.bodyBattery}
          icon={
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="6" width="12" height="8" rx="1.5" />
              <path d="M15 9v2h2V9h-2z" />
            </svg>
          }
        />
      </div>

      {/* 주간 차트 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <WeeklyChart title="주간 걸음 수" data={weeklySteps} color="#22c55e" />
        <WeeklyChart title="주간 안정시 심박" data={weeklyHR} color="#ef4444" />
      </div>

      {/* 최근 활동 */}
      <RecentActivities activities={recentActivities} />
    </div>
  );
}
