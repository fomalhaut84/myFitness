interface ConsistencyScoreProps {
  activeDays: number;   // 최근 28일 중 운동한 날
  totalDays: number;    // 28
}

export default function ConsistencyScore({ activeDays, totalDays }: ConsistencyScoreProps) {
  const score = totalDays > 0 ? Math.round((activeDays / totalDays) * 100) : 0;

  const getLabel = (s: number) => {
    if (s >= 70) return "훌륭함";
    if (s >= 50) return "양호";
    if (s >= 30) return "보통";
    return "부족";
  };

  const getColor = (s: number) => {
    if (s >= 70) return "#22c55e";
    if (s >= 50) return "#f59e0b";
    if (s >= 30) return "#fb923c";
    return "#ef4444";
  };

  const color = getColor(score);

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
        운동 꾸준함 (28일)
      </div>
      <div className="flex items-baseline gap-2 mb-3">
        <span
          className="text-3xl font-semibold font-[family-name:var(--font-geist-mono)]"
          style={{ color }}
        >
          {score}
        </span>
        <span className="text-sm" style={{ color }}>
          {getLabel(score)}
        </span>
      </div>

      {/* 프로그레스 바 */}
      <div className="h-2 rounded-full bg-surface overflow-hidden mb-2">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>

      <div className="text-[11px] text-dim">
        28일 중 <span className="text-bright">{activeDays}일</span> 운동
      </div>
    </div>
  );
}
