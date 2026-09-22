// #396 (M15-4): 이벤트 마커 글리프. 차트 · 범례 · 이벤트 목록 · 토글이 같은 모양을 쓴다 — 범례가 곧 배지.
// 마커는 지표가 아니므로 **무채색**: 레이스 = 밝은 실선, 지표 변경 = 회색 점선, 플랜 = 흰색 6% 면.
import type { HistoryEventKind } from "@/lib/history/markers";

export const MARKER_COLORS = { race: "#e5e5e5", metric: "#737373", plan: "#ffffff" } as const;
export const PLAN_BAND_OPACITY = 0.06;

export default function MarkerGlyph({ kind }: { kind: HistoryEventKind }) {
  if (kind === "plan") {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="flex-none">
        <rect x="1" y="1" width="10" height="10" fill="rgba(255,255,255,0.12)" stroke="#3a3a3a" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="flex-none">
      <line x1="6" y1="1" x2="6" y2="11" stroke={MARKER_COLORS[kind]} strokeWidth="1.5" strokeDasharray={kind === "metric" ? "2 2" : undefined} />
    </svg>
  );
}
