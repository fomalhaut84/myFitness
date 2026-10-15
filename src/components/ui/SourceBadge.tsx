import { dataSourceLabel } from "@/lib/data-source";

const BADGE_STYLE: Record<string, string> = {
  omron: "bg-teal-900/40 text-teal-300",
  garmin: "bg-blue-900/40 text-blue-300",
  manual: "bg-amber-900/40 text-amber-300",
};

/** 측정 출처 배지 (#514 — Garmin · OMRON · 직접 입력) */
export default function SourceBadge({ source }: { source: string | null | undefined }) {
  const label = dataSourceLabel(source);
  if (label === null) return null;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${BADGE_STYLE[source ?? ""] ?? "bg-border text-dim"}`}>
      {label}
    </span>
  );
}
