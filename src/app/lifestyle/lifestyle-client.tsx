"use client";

import WeeklyActivitySummary from "@/components/lifestyle/WeeklyActivitySummary";
import MonthlyHeatmap from "@/components/lifestyle/MonthlyHeatmap";
import ConsistencyScore from "@/components/lifestyle/ConsistencyScore";
import SleepRegularity from "@/components/lifestyle/SleepRegularity";

interface WeekSummary {
  count: number;
  totalDistance: number;
  totalDuration: number;
  restDays: number;
}

interface SleepEntry {
  date: string;
  sleepStartHour: number;
  wakeUpHour: number;
}

interface LifestyleClientProps {
  thisWeek: WeekSummary;
  lastWeek: WeekSummary;
  monthlyActiveDates: string[];
  year: number;
  month: number;
  consistencyActiveDays: number;
  sleepEntries: SleepEntry[];
}

export default function LifestyleClient({
  thisWeek,
  lastWeek,
  monthlyActiveDates,
  year,
  month,
  consistencyActiveDays,
  sleepEntries,
}: LifestyleClientProps) {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-1">생활 패턴</h1>
        <p className="text-dim text-sm">운동 꾸준함 · 수면 규칙성 분석</p>
      </div>

      {/* 이번 주 vs 지난 주 */}
      <div className="mb-6">
        <WeeklyActivitySummary thisWeek={thisWeek} lastWeek={lastWeek} />
      </div>

      {/* 꾸준함 + 수면 규칙성 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <ConsistencyScore activeDays={consistencyActiveDays} totalDays={28} />
        <SleepRegularity entries={sleepEntries} />
      </div>

      {/* 월간 히트맵 */}
      <MonthlyHeatmap
        year={year}
        month={month}
        activeDates={new Set(monthlyActiveDates)}
      />
    </div>
  );
}
