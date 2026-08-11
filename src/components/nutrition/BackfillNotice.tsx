"use client";

// #299: 오늘 항목 중 매크로/kcal 미측정 개수 안내.
// Codex P2 (PR #300 4회차): pending (backfill 재시도 대상) 과 terminal (attempts 상한 도달로
// 영구 미측정) 을 구분해 다른 카피/시각 사용.

interface Props {
  pendingCount: number;
  terminalCount?: number;
}

export default function BackfillNotice({ pendingCount, terminalCount = 0 }: Props) {
  if (pendingCount <= 0 && terminalCount <= 0) return null;
  return (
    <div className="flex flex-col gap-1 px-3 py-2 rounded-lg border border-border/70 bg-card">
      {pendingCount > 0 && (
        <div className="flex items-center gap-3">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
          <div className="text-[12px] text-sub flex-1">
            <span className="text-bright font-medium">{pendingCount}개 항목</span> 매크로 미측정 · backfill 대기중
          </div>
          <span className="text-[11px] font-[family-name:var(--font-geist-mono)] text-dim uppercase tracking-wider">cron</span>
        </div>
      )}
      {terminalCount > 0 && (
        <div className="flex items-center gap-3">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500"></span>
          <div className="text-[12px] text-sub flex-1">
            <span className="text-bright font-medium">{terminalCount}개 항목</span> 매크로 확정 실패 · 수동 편집 필요
          </div>
          <span className="text-[11px] font-[family-name:var(--font-geist-mono)] text-dim uppercase tracking-wider">final</span>
        </div>
      )}
    </div>
  );
}
