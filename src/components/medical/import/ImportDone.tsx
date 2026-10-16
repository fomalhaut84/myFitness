"use client";

// #532: 저장 완료 — 회차별 결과 한 줄 + 금회 결과로 이동.
import Link from "next/link";
import type { ImportRoundOutcome } from "@/lib/checkup/import/write";

interface ImportDoneProps {
  outcomes: readonly ImportRoundOutcome[];
  onAgain: () => void;
}

export default function ImportDone({ outcomes, onAgain }: ImportDoneProps) {
  const first = outcomes[0];
  return (
    <section aria-labelledby="done-title" className="bg-card border border-border rounded-xl p-5">
      <h2 id="done-title" className="text-base font-medium text-bright">
        {outcomes.length}개 회차에 저장했습니다
      </h2>
      <ul className="my-3">
        {outcomes.map((o) => (
          <li key={o.id} className="flex items-baseline gap-3 border-t border-border py-1.5 text-[13px] first:border-t-0">
            <span className="w-[100px] font-[family-name:var(--font-geist-mono)] font-medium text-bright">{o.date}</span>
            <span className="text-muted">
              {o.created ? `새 회차 · ${o.added}개 항목` : `기존 회차 · ${o.added}개 추가 · 덮어쓰기 ${o.overwritten} · 건너뜀 ${o.skipped}`}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {first && (
          <Link href={`/medical?round=${first.id}`} className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-[#04130a] hover:bg-accent-hover">
            저장한 결과 보기
          </Link>
        )}
        <button type="button" onClick={onAgain} className="rounded-lg border border-border bg-surface px-3.5 py-2 text-sm hover:border-border-hover">
          다른 결과지 가져오기
        </button>
      </div>
    </section>
  );
}
