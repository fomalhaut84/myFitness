// #552: 버전 상태 · 출처 배지 — 목록 · 상세 · 계보 레일 공용 (서버 · 클라이언트 양쪽에서 렌더)
import type { PromptSource, PromptStatus } from "@/lib/prompts/sync-plan";

export const SOURCE_LABELS: Record<PromptSource, string> = {
  code_default: "코드 기본값",
  manual: "직접 수정",
  ai_suggestion: "AI 제안",
  restore: "되돌림",
};

const SOURCE_CLASS: Record<PromptSource, string> = {
  code_default: "border border-border-hover text-sub",
  manual: "bg-surface-hover text-bright",
  ai_suggestion: "bg-violet-500/15 text-violet-300",
  restore: "bg-surface-hover text-bright",
};

const PILL = "whitespace-nowrap rounded-full px-2 py-px text-[11px]";

export function SourcePill({ source }: { source: PromptSource }) {
  return <span className={`${PILL} ${SOURCE_CLASS[source]}`}>{SOURCE_LABELS[source]}</span>;
}

/** 보관은 배지 없이 흐리게 (디자인 노트) — 사용 중 · 초안만 */
export function StatusPill({ status }: { status: PromptStatus }) {
  if (status === "active") return <span className={`${PILL} bg-[rgba(34,197,94,0.12)] text-accent`}>사용 중</span>;
  if (status === "draft") return <span className={`${PILL} border border-dashed border-border-hover bg-surface text-muted`}>초안</span>;
  return null;
}

export function WarnPill({ children }: { children: React.ReactNode }) {
  return <span className={`${PILL} bg-amber-900/40 text-amber-300`}>{children}</span>;
}
