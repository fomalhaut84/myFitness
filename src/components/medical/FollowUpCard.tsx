// #527 (2/2): 다가오는 추적검사 — 예정일 오름차순 · 60일 이내 amber · 지난 것 red.
import Link from "next/link";
import type { FollowUpDto } from "@/lib/checkup/dto";
import { followUpTiming } from "@/lib/checkup/view";

interface FollowUpCardProps {
  items: readonly FollowUpDto[];
  today: string;
}

const STATUS_CLASS = { overdue: "text-red-400", soon: "text-amber-300", later: "text-sub" } as const;

export default function FollowUpCard({ items, today }: FollowUpCardProps) {
  return (
    <section aria-labelledby="followup-title" className="bg-card border border-border rounded-xl px-4 py-3.5 mt-4">
      <h2 id="followup-title" className="text-[13px] font-medium text-bright mb-2.5">
        다가오는 추적검사
      </h2>
      {items.length === 0 ? (
        <p className="text-xs text-dim">판독문에 추적검사 권고가 있으면 여기에 모입니다</p>
      ) : (
        <ul>
          {items.map((f) => {
            const t = followUpTiming(f.followUpDue, today);
            return (
              <li key={`${f.checkupId}-${f.itemCode}`} className="border-t border-border py-2 first:border-t-0 first:pt-0">
                <Link href={`/medical?round=${f.checkupId}`} className="block hover:opacity-80">
                  <span className="block text-[13px] text-bright">{f.label}</span>
                  <span className={`block font-[family-name:var(--font-geist-mono)] text-xs ${STATUS_CLASS[t.status]}`}>
                    {f.followUpDue} · {t.text}
                  </span>
                  <span className="block text-xs text-dim">
                    {f.followUp ? `${f.followUp} ` : ""}({f.checkupDate} 검진)
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
