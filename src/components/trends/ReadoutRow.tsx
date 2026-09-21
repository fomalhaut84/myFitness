// #395 (M15-3): 차트 아래 판독값 띠 (3칸). `/history` 의 KPI 띠와 같은 형태 — 카드가 아니라 한 줄.
import Link from "next/link";

export interface Readout {
  label: string;
  /** null = 기록 없음 */
  text: string | null;
  unit?: string;
  caption?: string;
  href?: string;
}

export default function ReadoutRow({ items }: { items: readonly Readout[] }) {
  return (
    <dl className="mt-3.5 grid grid-cols-1 rounded-xl border border-border bg-card sm:grid-cols-3">
      {items.map((item, i) => (
        <div key={item.label} className={`min-w-0 px-3.5 py-3 ${i > 0 ? "border-t border-border sm:border-l sm:border-t-0" : ""}`}>
          <dt className="text-[11px] text-sub">{item.label}</dt>
          {item.text === null ? (
            <dd className="pt-1 text-[13px] text-dim">기록 없음</dd>
          ) : (
            <dd className="whitespace-nowrap font-[family-name:var(--font-geist-mono)] text-[17px] font-medium text-bright">
              {item.text}
              {item.unit && <span className="ml-1 text-[11px] font-normal text-sub">{item.unit}</span>}
              {item.caption &&
                (item.href ? (
                  <Link href={item.href} className="block font-sans text-[11px] font-normal text-sub underline-offset-2 hover:text-bright hover:underline">
                    {item.caption}
                  </Link>
                ) : (
                  <span className="block font-sans text-[11px] font-normal text-sub">{item.caption}</span>
                ))}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}
