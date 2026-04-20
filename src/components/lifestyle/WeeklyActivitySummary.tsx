import { formatDistance, formatDuration } from "@/lib/format";

interface WeeklyActivitySummaryProps {
  thisWeek: {
    count: number;
    totalDistance: number;
    totalDuration: number;
    restDays: number;
  };
  lastWeek: {
    count: number;
    totalDistance: number;
    totalDuration: number;
    restDays: number;
  };
}

function Delta({ current, prev, unit, invert }: { current: number; prev: number; unit?: string; invert?: boolean }) {
  const diff = current - prev;
  if (diff === 0) return null;
  const isGood = invert ? diff < 0 : diff > 0;
  return (
    <span className={`text-[11px] ml-2 ${isGood ? "text-[#22c55e]" : "text-[#ef4444]"}`}>
      {diff > 0 ? "+" : ""}{diff}{unit ?? ""}
    </span>
  );
}

export default function WeeklyActivitySummary({ thisWeek, lastWeek }: WeeklyActivitySummaryProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
        이번 주 활동 요약
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <div className="text-[11px] text-dim mb-1">운동 횟수</div>
          <div className="text-xl font-semibold font-[family-name:var(--font-geist-mono)]">
            {thisWeek.count}<span className="text-sm text-dim font-normal ml-1">회</span>
            <Delta current={thisWeek.count} prev={lastWeek.count} />
          </div>
        </div>
        <div>
          <div className="text-[11px] text-dim mb-1">총 거리</div>
          <div className="text-xl font-semibold font-[family-name:var(--font-geist-mono)]">
            {formatDistance(thisWeek.totalDistance)}<span className="text-sm text-dim font-normal ml-1">km</span>
            <Delta current={Math.round(thisWeek.totalDistance / 1000)} prev={Math.round(lastWeek.totalDistance / 1000)} unit="km" />
          </div>
        </div>
        <div>
          <div className="text-[11px] text-dim mb-1">총 시간</div>
          <div className="text-xl font-semibold font-[family-name:var(--font-geist-mono)]">
            {formatDuration(thisWeek.totalDuration)}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-dim mb-1">휴식일</div>
          <div className="text-xl font-semibold font-[family-name:var(--font-geist-mono)]">
            {thisWeek.restDays}<span className="text-sm text-dim font-normal ml-1">일</span>
          </div>
        </div>
      </div>
    </div>
  );
}
