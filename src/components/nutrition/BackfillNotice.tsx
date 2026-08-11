"use client";

// #299: 오늘 항목 중 매크로/kcal 미측정 개수 안내. backfill 대기 UI.

interface Props {
  pendingCount: number;
}

export default function BackfillNotice({ pendingCount }: Props) {
  if (pendingCount <= 0) return null;
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border/70 bg-card">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
      <div className="text-[12px] text-sub flex-1">
        <span className="text-bright font-medium">{pendingCount}개 항목</span> 매크로 미측정 · backfill 대기중
      </div>
      <span className="text-[11px] font-[family-name:var(--font-geist-mono)] text-dim uppercase tracking-wider">cron</span>
    </div>
  );
}
