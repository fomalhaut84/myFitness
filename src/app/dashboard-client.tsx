"use client";

import { useState } from "react";
import SummaryCard from "@/components/dashboard/SummaryCard";
import WeeklyChart from "@/components/dashboard/WeeklyChart";
import RecentActivities from "@/components/dashboard/RecentActivities";
import TrendLineChart from "@/components/ui/TrendLineChart";

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
  monthlySteps: DataPoint[];
  monthlyCalories: DataPoint[];
  monthlyStress: DataPoint[];
  monthlyBodyBattery: DataPoint[];
  monthlySpo2: DataPoint[];
  monthlyStressDetail: { date: string; high: number | null; medium: number | null; low: number | null }[];
  latestReport: {
    category: string;
    response: string;
    createdAt: string;
  } | null;
}

function calcAvg(data: DataPoint[]): number | null {
  const valid = data.filter((d) => d.value !== null);
  if (valid.length === 0) return null;
  return Math.round(
    valid.reduce((sum, d) => sum + (d.value ?? 0), 0) / valid.length
  );
}

export default function DashboardClient({
  today,
  yesterday,
  weeklySteps,
  weeklyHR,
  recentActivities,
  monthlySteps,
  monthlyCalories,
  monthlyStress,
  monthlyBodyBattery,
  monthlySpo2,
  monthlyStressDetail,
  latestReport,
}: DashboardClientProps) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
  const dayNames = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

  const avgSteps = calcAvg(monthlySteps);
  const avgCalories = calcAvg(monthlyCalories);
  const avgStress = calcAvg(monthlyStress);
  const avgBattery = calcAvg(monthlyBodyBattery);
  const avgSpo2 = calcAvg(monthlySpo2);

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (data.results) {
        const total = data.results.reduce((s: number, r: { synced: number }) => s + r.synced, 0);
        setSyncResult(`${total}건 싱크 완료`);
        // 2초 후 페이지 새로고침
        setTimeout(() => window.location.reload(), 2000);
      }
    } catch {
      setSyncResult("싱크 실패");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1">대시보드</h1>
          <p className="text-dim text-sm">
            {dateStr} {dayNames[now.getDay()]}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {syncResult && (
            <span className="text-[11px] text-accent">{syncResult}</span>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-sub border border-border hover:text-bright hover:border-border-hover transition-colors disabled:opacity-50"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={syncing ? "animate-spin" : ""}
            >
              <path d="M1 7a6 6 0 0 1 10.2-4.2M13 7a6 6 0 0 1-10.2 4.2" />
              <path d="M11.2 1v2.8H8.4M2.8 13v-2.8h2.8" />
            </svg>
            {syncing ? "싱크 중..." : "데이터 싱크"}
          </button>
        </div>
      </div>

      {/* 오늘 리포트 요약 */}
      {latestReport && (
        <a
          href="/reports"
          className="block bg-card border border-border rounded-xl p-4 mb-6 hover:border-border-hover transition-colors"
        >
          <div className="flex items-center gap-2 mb-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor:
                  latestReport.category === "morning_report"
                    ? "#f59e0b"
                    : "#a78bfa",
              }}
            />
            <span className="text-[11px] text-dim tracking-wider uppercase">
              {latestReport.category === "morning_report"
                ? "모닝 리포트"
                : "이브닝 리포트"}
            </span>
            <span className="text-[11px] text-dim ml-auto">
              자세히 보기 →
            </span>
          </div>
          <p className="text-[13px] text-muted line-clamp-2">
            {latestReport.response.replace(/[#*_`]/g, "").slice(0, 150)}...
          </p>
        </a>
      )}

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
      <div className="mb-8">
        <RecentActivities activities={recentActivities} />
      </div>

      {/* 30일 추세 */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-1">30일 추세</h2>
        <p className="text-dim text-[12px] mb-4">일일 통계 추이</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <TrendLineChart
          title={`걸음 수${avgSteps !== null ? ` — 평균 ${avgSteps.toLocaleString("ko-KR")}` : ""}`}
          data={monthlySteps}
          color="#22c55e"
        />
        <TrendLineChart
          title={`활동 칼로리${avgCalories !== null ? ` — 평균 ${avgCalories.toLocaleString("ko-KR")} kcal` : ""}`}
          data={monthlyCalories}
          color="#f59e0b"
          unit="kcal"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TrendLineChart
          title={`스트레스${avgStress !== null ? ` — 평균 ${avgStress}` : ""}`}
          data={monthlyStress}
          color="#ef4444"
          domain={[0, 100]}
        />
        <TrendLineChart
          title={`바디배터리${avgBattery !== null ? ` — 평균 ${avgBattery}` : ""}`}
          data={monthlyBodyBattery}
          color="#60a5fa"
          domain={[0, 100]}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <TrendLineChart
          title={`SpO2${avgSpo2 !== null ? ` — 평균 ${avgSpo2}%` : ""}`}
          data={monthlySpo2}
          color="#a78bfa"
          unit="%"
          domain={[85, 100]}
        />
        <StressDetailChart data={monthlyStressDetail} />
      </div>
    </div>
  );
}

function StressDetailChart({ data }: { data: { date: string; high: number | null; medium: number | null; low: number | null }[] }) {
  const hasData = data.some((d) => ((d.high ?? 0) + (d.medium ?? 0) + (d.low ?? 0)) > 0);

  if (!hasData) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">스트레스 세부 (30일)</div>
        <div className="h-40 flex items-center justify-center text-[13px] text-dim">데이터 없음</div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="text-[11px] text-dim tracking-wider uppercase mb-4">스트레스 세부 (30일)</div>
      <div className="space-y-1">
        {data.map((d) => {
          const total = (d.high ?? 0) + (d.medium ?? 0) + (d.low ?? 0);
          if (total === 0) return null;
          const hPct = ((d.high ?? 0) / total) * 100;
          const mPct = ((d.medium ?? 0) / total) * 100;
          const lPct = ((d.low ?? 0) / total) * 100;
          const dateShort = d.date.slice(5); // MM-DD
          return (
            <div key={d.date} className="flex items-center gap-2">
              <span className="text-[9px] text-dim w-10">{dateShort}</span>
              <div className="flex-1 flex h-3 rounded-sm overflow-hidden">
                {lPct > 0 && <div style={{ width: `${lPct}%`, backgroundColor: "#22c55e" }} />}
                {mPct > 0 && <div style={{ width: `${mPct}%`, backgroundColor: "#f59e0b" }} />}
                {hPct > 0 && <div style={{ width: `${hPct}%`, backgroundColor: "#ef4444" }} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-3 mt-2 text-[9px] text-dim">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#22c55e]" />저</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#f59e0b]" />중</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#ef4444]" />고</span>
      </div>
    </div>
  );
}
