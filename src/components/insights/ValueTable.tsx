// #397: 근거 표 — 헤더 한 줄 + 값 한 줄 (연도별 · 온도 구간별 · km 구간별). `CompareTable` 톤. 폰은 가로 스크롤.
export interface ValueCell {
  text: string | null;
  n?: number;
}

interface ValueTableProps {
  corner: string;
  headers: readonly string[];
  rowLabel: string;
  cells: readonly ValueCell[];
}

export default function ValueTable({ corner, headers, rowLabel, cells }: ValueTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-bg">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-[12px] font-medium text-sub">
            <th className="px-2.5 py-1.5 text-left font-medium">{corner}</th>
            {headers.map((h) => (
              <th key={h} className="whitespace-nowrap px-2.5 py-1.5 text-right font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-border">
            <th scope="row" className="whitespace-nowrap px-2.5 py-1.5 text-left text-[12px] font-normal text-muted">
              {rowLabel}
            </th>
            {cells.map((c, i) => (
              <td key={headers[i] ?? i} className="whitespace-nowrap px-2.5 py-1.5 text-right font-[family-name:var(--font-geist-mono)] text-[13px] font-medium text-bright">
                {c.text === null ? <span className="font-normal text-dim">—</span> : c.text}
                {c.n !== undefined && <span className="ml-1 text-[11px] font-normal text-dim">n={c.n}</span>}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
