// #445: 달력 계산은 `monthCells` (ymd 문자열 · 월요일 시작) — 이전의 로컬 TZ `new Date(y, m-1, 1)` 는 서버 TZ 에 따라 요일이 어긋났다 (#365).
import { todayKSTString } from "@/lib/garmin/utils";
import { WEEKDAY_LABELS, formatYm, monthCells } from "@/lib/history/month-cells";

interface MonthlyHeatmapProps {
  year: number;
  month: number; // 1-12
  activeDates: Set<string>; // "YYYY-MM-DD" 형식
}

export default function MonthlyHeatmap({ year, month, activeDates }: MonthlyHeatmapProps) {
  const { leadingBlanks, days } = monthCells(formatYm(year, month));
  const totalDays = days.length;
  const todayStr = todayKSTString();

  // 첫 주 빈칸 (null) + 그 달의 ymd
  const cells: (string | null)[] = [...Array.from({ length: leadingBlanks }, () => null), ...days];

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
        {year}년 {month}월 활동 캘린더
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="text-center text-[9px] text-dim">
            {d}
          </div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((dateStr, i) => {
          if (dateStr === null) return <div key={i} />;

          const day = Number(dateStr.slice(8, 10));
          const isActive = activeDates.has(dateStr);
          const isToday = dateStr === todayStr;

          return (
            <div
              key={i}
              className={`
                aspect-square rounded-md flex items-center justify-center text-[11px]
                ${isActive ? "bg-[#22c55e]/20 text-[#22c55e]" : "text-dim"}
                ${isToday ? "ring-1 ring-[#22c55e]/50" : ""}
              `}
            >
              {day}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 mt-3 text-[10px] text-dim">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-[#22c55e]/20" />
          <span>운동한 날</span>
        </div>
        <span>{activeDates.size}일 / {totalDays}일</span>
      </div>
    </div>
  );
}
