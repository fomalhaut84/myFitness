// #395 (M15-3): `/trends` 컨트롤. 형태로 위계를 나눈다 — 뷰 = 밑줄 탭 ("무엇을 묻는가", 질문 한 줄) · 지표 = pill
// (`/history` 와 공용) · 단위/기간 = 세그먼트. 뷰에 의미 없는 컨트롤은 숨긴다. 전부 링크 (서버 네비게이션).
import Link from "next/link";
import MetricPicker from "@/components/history/MetricPicker";
import {
  buildTrendsHref,
  type TrendsContext,
  type TrendsQuery,
  type TrendsRange,
  type TrendsUnit,
  type TrendsView,
} from "@/lib/history/trends-params";

interface TrendsControlsProps {
  query: TrendsQuery;
  ctx: TrendsContext;
  color: string;
}

const VIEWS: readonly { id: TrendsView; label: string; question: string }[] = [
  { id: "series", label: "시계열", question: "길게 보기" },
  { id: "yoy", label: "전년 동기", question: "연도끼리 겹치기" },
  { id: "season", label: "계절성", question: "몇 월에 어떤가" },
  { id: "compare", label: "기간 비교", question: "두 구간 나란히" },
];
const UNITS: readonly { id: TrendsUnit; label: string }[] = [
  { id: "week", label: "주" },
  { id: "month", label: "월" },
  { id: "year", label: "연" },
];
const RANGES: readonly { id: TrendsRange; label: string }[] = [
  { id: "1y", label: "1년" },
  { id: "3y", label: "3년" },
  { id: "all", label: "전체" },
];

function Segment<T extends string>({
  label,
  options,
  selected,
  hrefFor,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  selected: T;
  hrefFor: (id: T) => string;
}) {
  return (
    <div role="group" aria-label={label} className="flex overflow-hidden rounded-lg border border-border">
      {options.map((o, i) => (
        <Link
          key={o.id}
          href={hrefFor(o.id)}
          scroll={false}
          aria-current={o.id === selected ? "true" : undefined}
          className={`px-3 py-[5px] text-[13px] ${i > 0 ? "border-l border-border" : ""} ${
            o.id === selected ? "bg-surface text-bright" : "text-sub hover:text-bright"
          }`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

export default function TrendsControls({ query, ctx, color }: TrendsControlsProps) {
  return (
    <div>
      <h1 className="text-[22px] font-semibold tracking-tight text-bright sm:text-[26px]">추이</h1>
      <nav aria-label="보기" className="mb-[18px] mt-3.5 flex gap-[22px] overflow-x-auto border-b border-border [scrollbar-width:none]">
        {VIEWS.map((v) => {
          const active = v.id === query.view;
          return (
            <Link
              key={v.id}
              href={buildTrendsHref(query, { view: v.id }, ctx)}
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={`-mb-px whitespace-nowrap border-b-2 pb-2.5 pt-2 text-[14px] ${
                active ? "text-bright" : "border-transparent text-sub hover:text-bright"
              }`}
              style={active ? { borderColor: color } : undefined}
            >
              {v.label}
              <span className="block text-[11px] text-dim">{v.question}</span>
            </Link>
          );
        })}
      </nav>
      <MetricPicker hrefFor={(id) => buildTrendsHref(query, { metric: id }, ctx)} selected={query.metric} />
      {query.view === "series" && (
        <div className="mb-[18px] flex flex-wrap gap-3">
          <Segment label="단위" options={UNITS} selected={query.unit} hrefFor={(unit) => buildTrendsHref(query, { unit }, ctx)} />
          {/* 연 단위는 항상 전체 기간 (6년 = 막대 7개) — 기간 선택이 의미가 없어 숨긴다 */}
          {query.unit !== "year" && (
            <Segment label="기간" options={RANGES} selected={query.range} hrefFor={(range) => buildTrendsHref(query, { range }, ctx)} />
          )}
        </div>
      )}
    </div>
  );
}
