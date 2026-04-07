interface SummaryCardProps {
  label: string;
  value: number | null;
  unit?: string;
  prevValue: number | null;
  icon: React.ReactNode;
  invertDelta?: boolean; // true일 때 감소가 좋음 (심박)
}

export default function SummaryCard({
  label,
  value,
  unit,
  prevValue,
  icon,
  invertDelta = false,
}: SummaryCardProps) {
  const delta =
    value !== null && prevValue !== null ? value - prevValue : null;

  const isPositive = delta !== null && (invertDelta ? delta < 0 : delta > 0);
  const isNegative = delta !== null && (invertDelta ? delta > 0 : delta < 0);

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-dim">{icon}</span>
        <span className="text-[11px] text-dim tracking-wider uppercase">
          {label}
        </span>
      </div>

      <div className="text-2xl font-semibold font-[family-name:var(--font-geist-mono)] tracking-tight">
        {value !== null ? value.toLocaleString("ko-KR") : "—"}
        {unit && value !== null && (
          <span className="text-sm text-dim font-normal ml-1">{unit}</span>
        )}
      </div>

      {delta !== null && (
        <div className="flex items-center gap-1 mt-2">
          {isPositive && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M6 9V3M6 3l3 3M6 3L3 6"
                stroke="#22c55e"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          {isNegative && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M6 3V9M6 9l3-3M6 9L3 6"
                stroke="#ef4444"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          <span
            className={`text-[11px] ${
              isPositive
                ? "text-[#22c55e]"
                : isNegative
                  ? "text-[#ef4444]"
                  : "text-dim"
            }`}
          >
            {delta > 0 ? "+" : ""}
            {delta.toLocaleString("ko-KR")}
          </span>
          <span className="text-[11px] text-dim">전일 대비</span>
        </div>
      )}

      {delta === null && (
        <div className="mt-2">
          <span className="text-[11px] text-dim">데이터 없음</span>
        </div>
      )}
    </div>
  );
}
