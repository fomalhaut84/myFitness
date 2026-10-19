"use client";
// #552 M19-3 G2 (시안 E): AI 개선안 받기 → 진행 → 근거 + 사용 중 버전 대비 차이 + 검증 → 초안으로 저장 / 버리기.
// 저장해도 바로 쓰이지 않는다 — 초안으로 남고 시험 실행 후 활성화. 검증 오류가 있는 제안은 저장 불가.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PROMPT_NOTE_MAX_LENGTH, type PromptKey } from "@/lib/prompts/definitions";
import type { PromptRunDTO } from "@/lib/prompts/runs";
import { suggestionNote } from "@/lib/prompts/suggest-prompt";
import { removedToolMentions } from "@/lib/prompts/validate";
import type { PromptVersionDTO } from "@/lib/prompts/versions";
import DiffView, { DiffStatsText } from "./DiffView";
import { AI_BTN, GHOST, PRIMARY, QUOTA_TEXT, Spinner, postJson } from "./run-ui";
import useRunPoll from "./useRunPoll";

interface Props {
  promptKey: PromptKey;
  versions: readonly PromptVersionDTO[];
  /** 페이지를 다시 열었을 때 이어 볼 최근 개선안 (실행 중 · 막 끝난 것) */
  initialRun: PromptRunDTO | null;
}

export default function SuggestPanel({ promptKey, versions, initialRun }: Props) {
  const router = useRouter();
  const { run, error: pollError, pending, track, clear } = useRunPoll(initialRun);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const active = versions.find((v) => v.status === "active") ?? null;
  const base = run ? (versions.find((v) => v.id === run.versionId) ?? null) : active;

  async function start() {
    setBusy(true);
    setMessage(null);
    try {
      const { ok, data } = await postJson(`/api/prompts/${promptKey}/suggest`);
      if (!ok || typeof data.runId !== "string") {
        setMessage({ kind: "error", text: typeof data.error === "string" ? data.error : "개선안 받기를 시작하지 못했습니다" });
        return;
      }
      track(data.runId);
    } catch {
      setMessage({ kind: "error", text: "개선안 받기를 시작하지 못했습니다 — 네트워크 오류" });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const suggestion = run?.suggestion;
    if (!run || !suggestion) return;
    setBusy(true);
    setMessage(null);
    try {
      const { ok, data } = await postJson(`/api/prompts/${promptKey}/versions`, {
        body: suggestion.body,
        note: suggestionNote(suggestion.rationale, PROMPT_NOTE_MAX_LENGTH),
        basedOnId: run.versionId,
        activate: false,
        source: "ai_suggestion",
      });
      if (!ok) {
        setMessage({ kind: "error", text: typeof data.error === "string" ? data.error : "초안을 저장하지 못했습니다" });
        return;
      }
      clear();
      setMessage({ kind: "ok", text: `v${data.version} 초안으로 저장했습니다 — 오른쪽 버전 목록에서 시험 실행 · 활성화할 수 있습니다` });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "초안을 저장하지 못했습니다 — 네트워크 오류" });
    } finally {
      setBusy(false);
    }
  }

  const suggestion = run?.status === "done" ? run.suggestion : null;
  const errors = suggestion?.validation.errors ?? [];
  const removed = suggestion && base ? removedToolMentions(base.body, suggestion.body) : [];

  return (
    <section aria-label="AI 개선안" className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={AI_BTN} disabled={busy || pending || !active} onClick={start}>
          AI 개선안 받기
        </button>
        <span className="text-[11px] text-dim">{QUOTA_TEXT} · 사용 중 버전과 최근 결과 5건을 봅니다</span>
      </div>
      {message && (
        <p role="status" className={`rounded-lg px-3 py-2 text-xs ${message.kind === "ok" ? "bg-[rgba(34,197,94,0.12)] text-accent" : "bg-red-950/60 text-red-300"}`}>
          {message.text}
        </p>
      )}
      {pollError && <p className="text-xs text-amber-300">{pollError}</p>}

      {pending && (
        <p className="flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-3 text-[13px] text-sub">
          <Spinner />
          {base ? `v${base.version}` : "사용 중 버전"} 과 최근 결과를 보고 개선안을 만드는 중입니다
        </p>
      )}

      {run?.status === "failed" && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-300">
          <span className="min-w-0 flex-1">개선안을 받지 못했습니다 — {run.errorMessage ?? "알 수 없는 오류"}</span>
          <button type="button" className="text-sub hover:text-bright" onClick={clear}>
            닫기
          </button>
        </p>
      )}

      {run?.status === "done" && !suggestion && (
        <p className="rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-300">개선안 기록을 읽지 못했습니다. 다시 받아 보세요.</p>
      )}

      {suggestion && base && (
        <div className="min-w-0 rounded-xl border border-violet-500/40 bg-card">
          <div className="border-b border-border px-3.5 py-3">
            <h3 className="mb-1.5 text-[13px] font-medium text-violet-300">
              AI 개선안 · v{base.version} 기준
              {active && active.id !== base.id && <span className="ml-2 font-normal text-amber-300">지금 사용 중은 v{active.version} 입니다</span>}
            </h3>
            {suggestion.rationale.length > 0 ? (
              <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted">
                {suggestion.rationale.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-dim">근거가 없는 제안입니다</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 px-3.5 pt-2.5 text-xs text-sub">
            v{base.version} → 제안 <DiffStatsText oldText={base.body} newText={suggestion.body} />
          </div>
          <DiffView oldText={base.body} newText={suggestion.body} />
          <div className="border-t border-border px-3.5 py-2.5 text-xs">
            {errors.length > 0 ? (
              <ul className="space-y-0.5 text-red-300">
                {errors.map((e, i) => (
                  <li key={i}>✕ {e.message}</li>
                ))}
                <li className="text-sub">검증 오류가 있어 저장할 수 없습니다. 다시 받아 보세요.</li>
              </ul>
            ) : (
              <p className="text-accent">✓ 검증 통과</p>
            )}
            {removed.length > 0 && <p className="mt-1 text-amber-300">빠진 도구: {removed.join(" · ")} — 활성화할 때 확인이 필요합니다</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-3.5 py-2.5">
            <span className="text-[11px] text-dim">저장해도 바로 쓰이지 않습니다. 초안으로 남고, 시험 실행 후 활성화할 수 있습니다.</span>
            <span className="ml-auto flex gap-2">
              <button type="button" className={GHOST} disabled={busy} onClick={clear}>
                버리기
              </button>
              <button type="button" className={PRIMARY} disabled={busy || errors.length > 0} onClick={save}>
                초안으로 저장
              </button>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
