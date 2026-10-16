// #527 (2/2): 검진 회차 — 날짜 순서라 세로 타임라인 (모바일은 가로 스크롤 칩). 선택은 `?round=` 링크.
import Link from "next/link";
import type { CheckupSummaryDto } from "@/lib/checkup/dto";
import { KIND_LABEL } from "@/lib/checkup/view";
import { FLAG_PILL } from "./flag-style";

interface RoundTimelineProps {
  rounds: readonly CheckupSummaryDto[];
  currentId: string;
}

export default function RoundTimeline({ rounds, currentId }: RoundTimelineProps) {
  return (
    <nav aria-label="검진 회차" className="bg-card border border-border rounded-xl p-2">
      <ol className="relative flex gap-1.5 overflow-x-auto md:block md:before:absolute md:before:left-[19px] md:before:top-[18px] md:before:bottom-[18px] md:before:w-px md:before:bg-border">
        {rounds.map((r) => {
          const current = r.id === currentId;
          return (
            <li key={r.id} className="shrink-0">
              <Link
                href={`/medical?round=${r.id}`}
                aria-current={current ? "page" : undefined}
                className={`relative grid min-w-[136px] gap-2 rounded-lg border px-2 py-2.5 md:min-w-0 md:grid-cols-[24px_1fr] md:border-transparent ${
                  current ? "border-accent bg-surface md:border-transparent" : "border-border hover:bg-surface"
                }`}
              >
                <span
                  aria-hidden
                  className={`z-[1] mt-1.5 ml-[7px] hidden h-[9px] w-[9px] rounded-full border-[1.5px] md:block ${
                    current ? "border-accent bg-accent" : "border-sub bg-card"
                  }`}
                />
                <span>
                  <span className="block font-[family-name:var(--font-geist-mono)] text-[13px] font-medium text-bright">{r.date}</span>
                  {r.institution && <span className="block text-xs text-sub">{r.institution}</span>}
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-surface px-[7px] py-px text-[11px] text-sub">{KIND_LABEL[r.kind] ?? r.kind}</span>
                    {r.counts.caution > 0 && (
                      <span className={`rounded-full px-[7px] py-px text-[11px] ${FLAG_PILL.caution}`}>주의 {r.counts.caution}</span>
                    )}
                    {r.counts.abnormal > 0 && (
                      <span className={`rounded-full px-[7px] py-px text-[11px] ${FLAG_PILL.abnormal}`}>이상 {r.counts.abnormal}</span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
