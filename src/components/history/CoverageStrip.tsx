// #396 (M15-4): 데이터 커버리지 띠 — `/history` 연 뷰 상단. 기본은 접힌 한 줄 (매번 보는 정보가 아니다), 네이티브 `<details>` 로
// 펼치면 소스별 가로 막대 (하한 → 오늘 축). 무채색 — 지표 색은 선택 지표만 쓴다 (#394). JS 없음.
import type { CoverageStrip as CoverageStripModel } from "@/lib/history/coverage";

function ym(ymd: string): string {
  return ymd.slice(0, 7).replace("-", ".");
}

export default function CoverageStrip({ strip }: { strip: CoverageStripModel }) {
  // 축 라벨 = 시작 해 … 마지막 해 직전 + `오늘` (마지막 해는 `오늘` 이 대신한다). 등간격 라벨이라 퍼센트 막대와 수 % 어긋날 수 있다 — 정보성 띠.
  const fromYear = Number(strip.from.slice(0, 4));
  const toYear = Number(strip.to.slice(0, 4));
  const years = Array.from({ length: Math.max(1, toYear - fromYear) }, (_, i) => fromYear + i);
  return (
    <details className="group mb-3.5 rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 px-3.5 py-2 text-[12px] text-sub [&::-webkit-details-marker]:hidden">
        <b className="font-[family-name:var(--font-geist-mono)] text-[13px] font-medium text-muted">
          {ym(strip.from)} ~ {ym(strip.to)}
        </b>
        <span className="flex flex-wrap gap-x-3 gap-y-0.5">
          {strip.rows
            .filter((row) => row.count > 0)
            .map((row) => (
              <span key={row.id} className="whitespace-nowrap">
                {row.label} <span className="font-[family-name:var(--font-geist-mono)]">{row.count.toLocaleString("ko-KR")}{row.unit}</span>
              </span>
            ))}
        </span>
        <span className="ml-auto text-[11px] text-dim group-open:hidden">자세히</span>
        <span className="ml-auto hidden text-[11px] text-dim group-open:inline">접기</span>
      </summary>
      <div className="border-t border-border px-3.5 pb-3 pt-1.5">
        {strip.rows.map((row) => (
          <div key={row.id} className="grid grid-cols-[80px_1fr] items-center gap-x-3 py-[5px] sm:grid-cols-[96px_1fr_196px]">
            <span className="text-[12px] text-muted">
              {row.label}
              {row.note && <span className="ml-1 text-[11px] text-dim">{row.note}</span>}
            </span>
            <div className="relative h-1.5 rounded-[3px] bg-[#1c1c1c]" title={row.oldest && row.newest ? `${row.oldest} ~ ${row.newest}` : "기록 없음"}>
              {row.startPct !== null && row.endPct !== null && (
                <i className="absolute inset-y-0 rounded-[3px] bg-[#8f8f8f]" style={{ left: `${row.startPct}%`, right: `${100 - row.endPct}%` }} />
              )}
            </div>
            <span className="col-start-2 whitespace-nowrap font-[family-name:var(--font-geist-mono)] text-[12px] text-sub sm:col-start-3 sm:text-right">
              {row.oldest && row.newest ? `${ym(row.oldest)} ~ ${ym(row.newest)} · ${row.count.toLocaleString("ko-KR")}${row.unit}` : "기록 없음"}
            </span>
          </div>
        ))}
        <div className="flex justify-between pl-[92px] pt-1 font-[family-name:var(--font-geist-mono)] text-[10px] text-dim sm:pl-[108px] sm:pr-[208px]">
          {years.map((y) => (
            <span key={y}>{y}</span>
          ))}
          <span>오늘</span>
        </div>
      </div>
    </details>
  );
}
