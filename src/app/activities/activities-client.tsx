"use client";

import { useState } from "react";
import ActivityCard from "@/components/activity/ActivityCard";
import { formatDistance, formatPace, formatDuration } from "@/lib/format";

interface Activity {
  id: string;
  name: string;
  activityType: string;
  startTime: string;
  duration: number;
  distance: number | null;
  avgPace: number | null;
  avgHR: number | null;
  calories: number | null;
}

interface MonthSummary {
  count: number;
  totalDistance: number;
  totalDuration: number;
  avgPace: number | null;
}

interface ActivitiesClientProps {
  activities: Activity[];
  monthSummary: MonthSummary;
}

const FILTERS = [
  { key: "all", label: "전체" },
  { key: "running", label: "러닝" },
  { key: "strength", label: "근력" },
  { key: "other", label: "기타" },
];

export default function ActivitiesClient({
  activities,
  monthSummary,
}: ActivitiesClientProps) {
  const [filter, setFilter] = useState("all");

  const filtered =
    filter === "all"
      ? activities
      : filter === "other"
        ? activities.filter(
            (a) =>
              !a.activityType.includes("running") &&
              !a.activityType.includes("strength") &&
              !a.activityType.includes("fitness")
          )
        : filter === "strength"
          ? activities.filter(
              (a) =>
                a.activityType.includes("strength") ||
                a.activityType.includes("fitness")
            )
          : activities.filter((a) => a.activityType.includes(filter));

  const now = new Date();
  const monthLabel = `${now.getFullYear()}년 ${now.getMonth() + 1}월`;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-1">러닝/활동</h1>
        <p className="text-dim text-sm">활동 기록</p>
      </div>

      {/* 월간 러닝 요약 */}
      {monthSummary.count > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 mb-6">
          <div className="text-[11px] text-dim tracking-wider uppercase mb-3">
            {monthLabel} 러닝 요약
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-[15px]">
            <div>
              <span className="font-[family-name:var(--font-geist-mono)] text-xl font-semibold">
                {monthSummary.count}
              </span>
              <span className="text-dim ml-1 text-sm">회</span>
            </div>
            <div>
              <span className="font-[family-name:var(--font-geist-mono)] text-xl font-semibold">
                {formatDistance(monthSummary.totalDistance)}
              </span>
              <span className="text-dim ml-1 text-sm">km</span>
            </div>
            <div>
              <span className="font-[family-name:var(--font-geist-mono)] text-xl font-semibold">
                {formatDuration(monthSummary.totalDuration)}
              </span>
            </div>
            {monthSummary.avgPace !== null && (
              <div>
                <span className="text-dim text-sm mr-1">평균</span>
                <span className="font-[family-name:var(--font-geist-mono)] text-xl font-semibold">
                  {formatPace(monthSummary.avgPace)}
                </span>
                <span className="text-dim ml-1 text-sm">/km</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 필터 */}
      <div className="flex gap-1.5 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`
              px-3 py-1.5 rounded-lg text-[12px] tracking-wide transition-colors
              ${
                filter === f.key
                  ? "bg-card text-bright border border-border"
                  : "text-sub hover:text-muted"
              }
            `}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 활동 목록 */}
      {filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((a) => (
            <ActivityCard key={a.id} {...a} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-dim text-[13px]">
          활동 기록 없음
        </div>
      )}
    </div>
  );
}
