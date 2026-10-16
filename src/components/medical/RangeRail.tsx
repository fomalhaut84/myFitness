// #527 (2/2): 범위 막대 — 기준범위 띠 + 직전 값 (빈 점) → 이번 값 (판정 색 점). 이 화면의 유일한 강조 요소 (디자인 노트).
// SVG 를 늘리면 모바일에서 점이 타원이 되므로 % 위치 HTML 로 그린다. 좌표 계산은 `lib/checkup/view.ts` (테스트).
import { railGeometry, type FlagTone } from "@/lib/checkup/view";
import { FLAG_DOT } from "./flag-style";

interface RangeRailProps {
  value: number;
  previous: number | null;
  refLow: number | null;
  refHigh: number | null;
  tone: FlagTone;
  label: string;
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

export default function RangeRail({ value, previous, refLow, refHigh, tone, label }: RangeRailProps) {
  const g = railGeometry({ value, previous, refLow, refHigh });
  const linkFrom = g.previousX === null ? null : Math.min(g.previousX, g.valueX);
  const linkTo = g.previousX === null ? null : Math.max(g.previousX, g.valueX);

  return (
    <div role="img" aria-label={label} className="relative mx-1.5 h-[22px] w-[calc(100%-12px)] md:w-[150px]">
      <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-border-hover" />
      {g.band && (
        <div
          className={`absolute top-[4px] h-[14px] rounded-[3px] bg-green-500/15 ${g.showLowEdge ? "border-l border-green-500/45" : ""} ${g.showHighEdge ? "border-r border-green-500/45" : ""}`}
          style={{ left: pct(g.band[0]), width: pct(Math.max(0, g.band[1] - g.band[0])) }}
        />
      )}
      {linkFrom !== null && linkTo !== null && (
        <div className="absolute top-1/2 h-[1.5px] -translate-y-1/2 bg-dim" style={{ left: pct(linkFrom), width: pct(linkTo - linkFrom) }} />
      )}
      {g.previousX !== null && (
        <div
          className="absolute top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-sub bg-card"
          style={{ left: pct(g.previousX) }}
        />
      )}
      <div
        className={`absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full ${FLAG_DOT[tone ?? "none"]}`}
        style={{ left: pct(g.valueX) }}
      />
    </div>
  );
}
