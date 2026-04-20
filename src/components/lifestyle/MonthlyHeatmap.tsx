interface MonthlyHeatmapProps {
  year: number;
  month: number; // 1-12
  activeDates: Set<string>; // "YYYY-MM-DD" 형식
}

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export default function MonthlyHeatmap({ year, month, activeDates }: MonthlyHeatmapProps) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const startDow = firstDay.getDay();
  const totalDays = lastDay.getDate();

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const cells: (number | null)[] = [];
  // 첫 주 빈칸
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
        {year}년 {month}월 활동 캘린더
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-center text-[9px] text-dim">
            {d}
          </div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;

          const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
