// #552 U1: 프롬프트 목록 — 묶음 (공통 · 리포트 · 운동 평가) 별 카드. 열기 전에 코드 기본값을 DB 와 맞춘다 (R2 · idempotent)
import Link from "next/link";
import { SourcePill, WarnPill } from "@/components/prompts/PromptPills";
import { formatPromptDate } from "@/components/prompts/format";
import { PROMPT_DEFINITIONS, PROMPT_GROUP_LABELS, type PromptGroup } from "@/lib/prompts/definitions";
import { ensureDefaults } from "@/lib/prompts/resolve";
import { listPromptSummaries, type PromptSummaryDTO } from "@/lib/prompts/versions";

export const dynamic = "force-dynamic";

const GROUPS: PromptGroup[] = ["common", "report", "activity"];

function PromptCard({ summary, wide }: { summary: PromptSummaryDTO; wide: boolean }) {
  const def = PROMPT_DEFINITIONS[summary.key];
  return (
    <Link
      href={`/settings/prompts/${summary.key}`}
      className={`grid gap-2 rounded-xl border border-border bg-card px-4 py-3.5 hover:border-border-hover ${wide ? "md:col-span-2 xl:col-span-3" : ""}`}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-bright">{def.label}</span>
        {summary.active && <span className="font-mono text-[13px] font-medium text-accent">v{summary.active.version}</span>}
      </span>
      <span className="text-xs text-sub">{def.usage}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-xs">
        {summary.active ? <SourcePill source={summary.active.source} /> : <WarnPill>사용 중 버전 없음 · 코드 기본값 사용</WarnPill>}
        {summary.draftCount > 0 && (
          <span className="rounded-full border border-dashed border-border-hover bg-surface px-2 py-px text-[11px] text-muted">초안 {summary.draftCount}</span>
        )}
        {summary.pendingCodeDefault && <WarnPill>코드 기본값 갱신</WarnPill>}
        {summary.active?.activatedAt && (
          <span className="ml-auto font-mono text-dim">{formatPromptDate(summary.active.activatedAt)} 활성화</span>
        )}
      </span>
    </Link>
  );
}

export default async function PromptsPage() {
  await ensureDefaults();
  const summaries = await listPromptSummaries();
  const pending = summaries.filter((s) => s.pendingCodeDefault);

  return (
    <div>
      <div className="mb-5">
        <h1 className="mb-1 text-2xl font-semibold">프롬프트</h1>
        <p className="text-sm text-dim">AI 분석에 쓰는 프롬프트를 고치고 버전으로 관리합니다</p>
      </div>

      {pending.length > 0 && (
        <div className="mb-4 rounded-xl bg-amber-900/40 px-4 py-2.5 text-sm text-amber-100">
          <span className="font-medium text-amber-300">코드 기본값이 바뀌었습니다.</span>{" "}
          {pending.map((s) => PROMPT_DEFINITIONS[s.key].label).join(" · ")} — 웹에서 고친 버전을 쓰고 있어 새 기본값을 초안으로 넣어 두었습니다. 상세에서 차이를 보고 반영하세요.
        </div>
      )}

      {GROUPS.map((group) => (
        <section key={group} className="mb-5">
          <h2 className="mb-2 text-xs text-sub">{PROMPT_GROUP_LABELS[group]}</h2>
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {summaries
              .filter((s) => PROMPT_DEFINITIONS[s.key].group === group)
              .map((s) => (
                <PromptCard key={s.key} summary={s} wide={group === "common"} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
