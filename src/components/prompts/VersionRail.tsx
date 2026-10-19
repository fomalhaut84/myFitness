"use client";
// #552 U3: 버전 계보 레일 — 노드 모양 = 출처, 녹색 고리 = 사용 중, 보관은 흐리게 (디자인 노트 "이 화면의 강조")
import type { PromptSource } from "@/lib/prompts/sync-plan";
import type { PromptVersionDTO } from "@/lib/prompts/versions";
import { SOURCE_LABELS, SourcePill, StatusPill } from "./PromptPills";
import { formatPromptDateTime } from "./format";

const DOT: Record<PromptSource, string> = {
  code_default: "border-2 border-sub bg-bg",
  manual: "bg-bright",
  ai_suggestion: "bg-violet-300",
  restore: "border border-bright bg-bright shadow-[inset_0_0_0_3px_var(--card)]",
};

const SMALL_BTN = "rounded-lg border border-border bg-surface px-2 py-0.5 text-xs hover:border-border-hover disabled:opacity-45";
const GHOST_BTN = "rounded-lg px-2 py-0.5 text-xs text-sub hover:text-bright disabled:opacity-45";

function Dot({ source, active, className = "" }: { source: PromptSource; active?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={`relative z-10 inline-block h-3 w-3 shrink-0 rounded-full ${DOT[source]} ${active ? "outline outline-2 outline-offset-[3px] outline-accent" : ""} ${className}`}
    />
  );
}

interface Props {
  versions: readonly PromptVersionDTO[];
  compareIds: readonly string[];
  busy: boolean;
  onToggleCompare: (id: string) => void;
  onActivate: (version: PromptVersionDTO) => void;
  onRestore: (version: PromptVersionDTO) => void;
}

function origin(v: PromptVersionDTO): string | null {
  if (v.basedOnVersion === null) return null;
  if (v.source === "ai_suggestion") return `v${v.basedOnVersion} 에서 제안`;
  if (v.source === "restore") return null; // 메모가 "vN 로 되돌림"
  return `v${v.basedOnVersion} 에서 고침`;
}

export default function VersionRail({ versions, compareIds, busy, onToggleCompare, onActivate, onRestore }: Props) {
  return (
    <aside className="rounded-xl border border-border bg-card">
      <div className="px-3.5 pb-1.5 pt-3.5">
        <h2 className="text-[13px] font-medium text-bright">버전</h2>
        <p className="mb-2.5 text-[11px] text-dim">두 개를 고르면 차이를 봅니다</p>
        <ol>
          {versions.map((v, i) => {
            const archived = v.status === "archived";
            const checked = compareIds.includes(v.id);
            const from = origin(v);
            return (
              <li key={v.id} className="relative grid grid-cols-[22px_minmax(0,1fr)] gap-2.5 pb-3.5">
                {i < versions.length - 1 && <span aria-hidden className="absolute bottom-0 left-[10px] top-[18px] border-l border-border-hover" />}
                <Dot source={v.source} active={v.status === "active"} className={`ml-[5px] mt-1 ${archived ? "opacity-45" : ""}`} />
                <div className="grid min-w-0 gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className={`font-mono text-[13px] font-medium ${archived ? "text-sub" : "text-bright"}`}>v{v.version}</span>
                    <StatusPill status={v.status} />
                    <SourcePill source={v.source} />
                  </span>
                  {v.note && <span className="text-xs text-muted">{v.note}</span>}
                  {from && <span className="text-[11px] text-dim">{from}</span>}
                  <span className="font-mono text-[11px] text-dim">{formatPromptDateTime(v.createdAt)}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1">
                    <label className="mr-1 inline-flex cursor-pointer items-center gap-1 text-[11px] text-sub">
                      <input type="checkbox" checked={checked} onChange={() => onToggleCompare(v.id)} aria-label={`v${v.version} 비교`} className="accent-[var(--accent)]" />
                      비교
                    </label>
                    {v.status === "draft" && (
                      <button type="button" className={SMALL_BTN} disabled={busy} onClick={() => onActivate(v)}>
                        활성화
                      </button>
                    )}
                    {archived && (
                      <button type="button" className={GHOST_BTN} disabled={busy} onClick={() => onRestore(v)}>
                        이 버전으로 되돌리기
                      </button>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="flex flex-wrap gap-2.5 border-t border-border px-3.5 py-2 text-[11px] text-sub">
        {(Object.keys(SOURCE_LABELS) as PromptSource[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <Dot source={s} className="!h-[9px] !w-[9px]" />
            {SOURCE_LABELS[s]}
          </span>
        ))}
      </div>
    </aside>
  );
}
