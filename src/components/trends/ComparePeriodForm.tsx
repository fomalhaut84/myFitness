"use client";

// #395 (M15-3): 비교 구간 선택. 네이티브 month 입력 직접 노출 (`/history` 와 같은 결정). uncontrolled + key —
// controlled 로 두면 텍스트 폴백 브라우저에서 타이핑이 막힌다 (#394 사전 리뷰 major 1).
// 역순이 되는 선택은 무시한다 (서버도 역순 구간은 기본값으로 되돌린다).
import { useRouter } from "next/navigation";
import { isValidYm } from "@/lib/history/month-cells";
import {
  buildTrendsHref,
  monthRangeLength,
  type MonthRange,
  type TrendsContext,
  type TrendsQuery,
} from "@/lib/history/trends-params";

interface ComparePeriodFormProps {
  query: TrendsQuery;
  ctx: TrendsContext;
  color: string;
}

const INPUT_CLASS =
  "min-w-0 rounded-lg border border-border bg-transparent px-2 py-[5px] font-[family-name:var(--font-geist-mono)] text-[13px] text-muted [color-scheme:dark] hover:border-border-hover";

export default function ComparePeriodForm({ query, ctx, color }: ComparePeriodFormProps) {
  const router = useRouter();
  const minYm = ctx.lowerBound.slice(0, 7);
  const maxYm = ctx.today.slice(0, 7);

  function update(which: "a" | "b", patch: Partial<MonthRange>) {
    const next = { ...query[which], ...patch };
    if (!isValidYm(next.fromYm) || !isValidYm(next.toYm)) return;
    if (next.fromYm > next.toYm || next.fromYm < minYm || next.toYm > maxYm) return;
    router.push(buildTrendsHref(query, { [which]: next }, ctx), { scroll: false });
  }

  const periods = [
    { which: "a" as const, badge: "A", badgeColor: "#a3a3a3", range: query.a },
    { which: "b" as const, badge: "B", badgeColor: color, range: query.b },
  ];

  return (
    <div className="mb-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
      {periods.map(({ which, badge, badgeColor, range }) => (
        <fieldset key={which} className="rounded-xl border border-border bg-card px-3.5 py-3">
          <legend className="sr-only">구간 {badge}</legend>
          <div>
            <span
              aria-hidden
              className="mr-2 inline-block h-5 w-5 rounded-md text-center font-[family-name:var(--font-geist-mono)] text-[12px] font-semibold leading-5 text-bg"
              style={{ background: badgeColor }}
            >
              {badge}
            </span>
            <span className="text-bright">
              {range.fromYm.replace("-", ".")} ~ {range.toYm.replace("-", ".")}
            </span>
            <span className="ml-1.5 text-[12px] text-sub">{monthRangeLength(range)}개월</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <input
              key={`${which}-from-${range.fromYm}`}
              type="month"
              aria-label={`구간 ${badge} 시작`}
              defaultValue={range.fromYm}
              min={minYm}
              max={maxYm}
              onChange={(e) => update(which, { fromYm: e.target.value })}
              className={INPUT_CLASS}
            />
            <span aria-hidden className="text-[12px] text-sub">~</span>
            <input
              key={`${which}-to-${range.toYm}`}
              type="month"
              aria-label={`구간 ${badge} 끝`}
              defaultValue={range.toYm}
              min={minYm}
              max={maxYm}
              onChange={(e) => update(which, { toYm: e.target.value })}
              className={INPUT_CLASS}
            />
          </div>
        </fieldset>
      ))}
    </div>
  );
}
