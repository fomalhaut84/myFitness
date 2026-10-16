// #544: 복용 기간 타임라인 — 장기 막대 (같은 이름은 한 줄) · 단기 점 · 검진 회차 녹색 점선. 좌표는 lib/medication/timeline.
import type { Timeline } from "@/lib/medication/timeline";
import { BAR_CLASS } from "./med-style";

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

export default function MedTimeline({ timeline }: { timeline: Timeline }) {
  const shortCount = timeline.shortDots.length;
  return (
    <section aria-labelledby="med-timeline" className="mb-6">
      <h2 id="med-timeline" className="mb-2.5 text-[13px] font-medium text-bright">
        복용 기간 <span className="ml-1 text-xs font-normal text-dim">검진 회차는 녹색 점선</span>
      </h2>
      <div className="overflow-x-auto rounded-xl border border-border bg-card px-4 pb-2.5 pt-3.5">
        <div className="relative min-w-[600px]" role="img" aria-label="복약 기간과 검진 회차 타임라인">
          <div className="relative ml-[130px] h-[18px] font-[family-name:var(--font-geist-mono)] text-[11px] text-dim">
            {timeline.years.map((y) => (
              <span key={y.year} className="absolute -translate-x-1/2" style={{ left: pct(y.x) }}>
                {y.year}
              </span>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-[130px] right-0">
            {timeline.checkups.map((c, i) => (
              // accent 는 CSS 변수 색이라 tailwind 투명도 수식어가 먹지 않는다 — 녹색 (#22c55e) 60% (1px 점선이라 흐리면 회색으로 보인다)
              <i key={`${i}-${c.date}`} title={`${c.date} 검진`} className="absolute bottom-0 top-[18px] border-l border-dashed" style={{ left: pct(c.x), borderColor: "rgba(34,197,94,.6)" }} />
            ))}
          </div>
          {timeline.lanes.map((lane) => (
            <div key={lane.key} className="grid h-[26px] grid-cols-[130px_1fr] items-center">
              <span className="truncate pr-2 text-xs text-muted">{lane.name}</span>
              <span className="relative h-full">
                {lane.bars.map((b) => (
                  <span
                    key={b.id}
                    className={`absolute top-2 h-2.5 rounded-full ${BAR_CLASS[lane.kind]}`}
                    style={{ left: pct(b.x0), width: `max(4px, ${pct(b.x1 - b.x0)})` }}
                  />
                ))}
              </span>
            </div>
          ))}
          {shortCount > 0 && (
            <div className="grid h-[26px] grid-cols-[130px_1fr] items-center">
              <span className="truncate pr-2 text-xs text-muted">단기 복용 {shortCount}건</span>
              <span className="relative h-full">
                {timeline.shortDots.map((d) => (
                  <span key={d.id} title={d.name} className="absolute top-[9px] h-2 w-2 -translate-x-1/2 rounded-full bg-sub" style={{ left: pct(d.x) }} />
                ))}
              </span>
            </div>
          )}
          <p className="ml-[130px] mt-2 flex flex-wrap gap-3.5 text-[11px] text-sub">
            <span>
              <i className="mr-1 inline-block h-1.5 w-3.5 rounded-sm bg-indigo-300 align-middle" />
              처방 · 장기
            </span>
            <span>
              <i className="mr-1 inline-block h-1.5 w-3.5 rounded-sm bg-teal-300 align-middle" />
              영양제 · 장기
            </span>
            <span>
              <i className="mr-1 inline-block h-2 w-2 rounded-full bg-sub align-middle" />
              단기 복용
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
