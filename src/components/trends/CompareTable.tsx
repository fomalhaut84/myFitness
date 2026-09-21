// #395 (M15-3): 기간 비교 표 — A | B | B − A. 차트가 아니라 표: 두 구간 × 지표 8개는 막대 16개보다 숫자가 빨리 읽힌다.
// 차이에 좋고 나쁨 색을 넣지 않는다 (거리는 높을수록, 심박·페이스는 낮을수록 — 지표마다 방향이 다르다).
// 모바일은 단위를 셀에서 빼 행 제목 옆으로 옮겨 360px 에 3열이 들어가게 한다.
import type { CompareCell, CompareRow } from "@/lib/history/compare";

interface CompareTableProps {
  rows: readonly CompareRow[];
  color: string;
  lengthsDiffer: boolean;
}

function ValueCell({ cell, unit }: { cell: CompareCell; unit: string }) {
  if (cell.text === null) return <td className="px-2 py-2.5 text-right text-[13px] text-dim sm:px-3.5">기록 없음</td>;
  return (
    <td className="whitespace-nowrap px-2 py-2.5 text-right font-[family-name:var(--font-geist-mono)] text-[12.5px] font-medium text-bright sm:px-3.5 sm:text-[15px]">
      {cell.text}
      {unit && <span className="ml-1 hidden text-[11px] font-normal text-sub sm:inline">{unit}</span>}
      {cell.perMonthText !== null && <span className="block text-[11px] font-normal text-sub">월 {cell.perMonthText}</span>}
    </td>
  );
}

export default function CompareTable({ rows, color, lengthsDiffer }: CompareTableProps) {
  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-[12px] font-medium text-sub">
              <th scope="col" className="px-2 py-2.5 text-left sm:px-3.5">
                <span className="sr-only">지표</span>
              </th>
              <th scope="col" className="px-2 py-2.5 text-right font-medium sm:px-3.5">A</th>
              <th scope="col" className="px-2 py-2.5 text-right font-medium sm:px-3.5">B</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2.5 text-right font-medium sm:px-3.5">B − A</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className="border-t border-border"
                style={row.selected ? { background: `color-mix(in srgb, ${color} 7%, transparent)` } : undefined}
              >
                <th scope="row" className={`px-2 py-2.5 text-left text-[12px] sm:px-3.5 sm:text-[13px] ${row.selected ? "font-medium text-bright" : "font-normal text-muted"}`}>
                  {row.label}
                  {row.unit && <span className="ml-1 text-[11px] font-normal text-dim sm:hidden">{row.unit}</span>}
                </th>
                <ValueCell cell={row.a} unit={row.unit} />
                <ValueCell cell={row.b} unit={row.unit} />
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-[family-name:var(--font-geist-mono)] text-[12.5px] font-medium text-muted sm:px-3.5 sm:text-[15px]">
                  {row.diffText ?? <span className="text-dim">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2.5 text-[11px] leading-relaxed text-sub">
        차이에는 좋고 나쁨 색을 넣지 않습니다. 거리는 높을수록, 심박과 페이스는 낮을수록 좋아서 방향이 지표마다 다릅니다.
        {lengthsDiffer && " 구간 길이가 달라 합계 지표는 월평균을 함께 표시합니다."}
      </p>
    </div>
  );
}
