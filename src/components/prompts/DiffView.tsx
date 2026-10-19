// #552 U3: 두 버전의 줄 단위 차이 — 같은 줄은 앞뒤 2줄만 남기고 접는다
import { diffLines, diffStats, foldDiff, type DiffLine } from "@/lib/prompts/diff";

const ROW = "grid grid-cols-[34px_34px_18px_minmax(0,1fr)] whitespace-pre-wrap [overflow-wrap:anywhere]";

function Row({ line }: { line: DiffLine }) {
  const oldNo = line.type === "add" ? "" : line.oldLine;
  const newNo = line.type === "del" ? "" : line.newLine;
  const tone = line.type === "add" ? "bg-green-500/10 text-green-300" : line.type === "del" ? "bg-red-400/10 text-red-300" : "text-muted";
  const sign = line.type === "add" ? "+" : line.type === "del" ? "−" : "";
  return (
    <div className={`${ROW} ${tone}`}>
      <span className="pr-1.5 text-right text-[#3a3a3a]">{oldNo}</span>
      <span className="pr-1.5 text-right text-[#3a3a3a]">{newNo}</span>
      <span className="text-center">{sign}</span>
      <span>{line.text.length > 0 ? line.text : " "}</span>
    </div>
  );
}

export function DiffStatsText({ oldText, newText }: { oldText: string; newText: string }) {
  const { added, removed } = diffStats(diffLines(oldText, newText));
  return (
    <span className="font-mono text-xs">
      <span className="text-accent">+{added}</span> <span className="text-red-400">−{removed}</span>
    </span>
  );
}

export default function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const blocks = foldDiff(diffLines(oldText, newText));
  if (blocks.every((b) => b.kind === "fold")) {
    return <p className="px-4 py-6 text-center text-sm text-sub">두 버전의 본문이 같습니다</p>;
  }
  return (
    <div className="overflow-x-auto py-2 font-mono text-[12.5px] leading-[1.7]">
      {blocks.map((b, i) =>
        b.kind === "fold" ? (
          <div key={`f${i}`} className="bg-surface py-1 pl-[86px] text-[11px] text-dim">
            ⋯ 같은 줄 {b.count}개
          </div>
        ) : (
          <Row key={`l${i}`} line={b.line} />
        ),
      )}
    </div>
  );
}
