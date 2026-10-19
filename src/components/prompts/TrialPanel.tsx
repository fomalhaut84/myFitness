"use client";
// #552 M19-3 T4 (시안 F · F′): 초안 시험 실행 — 대상 선택 → 실행 → 시험 결과와 같은 대상의 최근 실제 결과를 나란히 · 이 버전의 시험 기록.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistance } from "@/lib/format";
import { PROMPT_DEFINITIONS, type PromptKey } from "@/lib/prompts/definitions";
import { REPORT_KEYS, evalKeyForActivity, type ReportKey } from "@/lib/prompts/run-plan";
import type { PromptRunDTO } from "@/lib/prompts/runs";
import type { PromptVersionDTO } from "@/lib/prompts/versions";
import { formatPromptDate, formatPromptDateTime } from "./format";
import { categoryLabel } from "./result-labels";
import ResultDoc from "./ResultDoc";
import { BTN, PRIMARY, QUOTA_TEXT, Spinner, postJson } from "./run-ui";
import useRunPoll from "./useRunPoll";

/** 시험 대상 후보 — 상세 페이지가 최근 활동을 넘긴다 */
export interface TrialActivity {
  id: string;
  name: string;
  activityType: string;
  startTime: string;
  distance: number | null;
}

interface Props {
  promptKey: PromptKey;
  version: PromptVersionDTO;
  activities: readonly TrialActivity[];
  /** 이 버전의 시험 기록 (최신순) */
  runs: readonly PromptRunDTO[];
  onClose: () => void;
}

type SystemTarget = ReportKey | "activity";

function activityLabel(a: TrialActivity): string {
  const distance = a.distance && a.distance > 0 ? ` · ${formatDistance(a.distance)}` : "";
  return `${formatPromptDate(a.startTime)} ${a.name}${distance}`;
}

function durationText(run: PromptRunDTO): string | null {
  if (!run.completedAt) return null;
  const sec = Math.round((Date.parse(run.completedAt) - Date.parse(run.startedAt)) / 1000);
  return sec >= 60 ? `${Math.floor(sec / 60)}분 ${String(sec % 60).padStart(2, "0")}초` : `${sec}초`;
}

function targetText(run: PromptRunDTO, activities: readonly TrialActivity[]): string {
  if (run.targetKind === "report" && run.targetRef) return categoryLabel(run.targetRef);
  const activity = activities.find((a) => a.id === run.targetRef);
  return activity ? activityLabel(activity) : "활동";
}

export default function TrialPanel({ promptKey, version, activities, runs, onClose }: Props) {
  const router = useRouter();
  const isEval = promptKey === "activity_eval" || promptKey === "activity_eval_brief";
  const isSystem = promptKey === "system";
  // 평가 초안은 같은 종류 활동만 — 다른 종류는 서버도 거부 (run-plan activityMismatchError)
  const candidates = isEval ? activities.filter((a) => evalKeyForActivity(a.activityType) === promptKey) : activities;
  const [systemTarget, setSystemTarget] = useState<SystemTarget>("morning_report");
  const [activityId, setActivityId] = useState(candidates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, actual, error: pollError, pending, track } = useRunPoll(runs[0] ?? null);

  // 시험이 끝나면 서버 목록 (시험 기록) 을 다시 받는다 — 처음부터 끝나 있던 기록으로는 새로고침하지 않는다.
  // 열 때 실행 중이던 기록은 끝났을 때 새로고침해야 목록의 "실행 중" 이 바뀐다 (PR #560 Codex P2)
  const initialId = useRef(runs[0] && runs[0].status !== "running" ? runs[0].id : null);
  const settledId = run && run.status !== "running" ? run.id : null;
  useEffect(() => {
    if (settledId && settledId !== initialId.current) router.refresh();
  }, [settledId, router]);

  const needsActivity = isEval || (isSystem && systemTarget === "activity");

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const body = isSystem ? { target: systemTarget, ...(systemTarget === "activity" ? { activityId } : {}) } : isEval ? { activityId } : {};
      const { ok, data } = await postJson(`/api/prompts/versions/${version.id}/trial`, body);
      if (!ok || typeof data.runId !== "string") {
        setError(typeof data.error === "string" ? data.error : "시험 실행을 시작하지 못했습니다");
        return;
      }
      track(data.runId);
    } catch {
      setError("시험 실행을 시작하지 못했습니다 — 네트워크 오류");
    } finally {
      setBusy(false);
    }
  }

  const activitySelect = (
    <label className="flex min-w-0 items-center gap-1.5 text-xs text-sub">
      평가할 활동
      <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className="min-w-0 max-w-[260px] rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-bright">
        {candidates.map((a) => (
          <option key={a.id} value={a.id}>
            {activityLabel(a)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section aria-label={`v${version.version} 시험 실행`} className="min-w-0 rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-3.5 py-2.5 text-xs text-sub">
        <span className="whitespace-nowrap rounded-full border border-dashed border-border-hover bg-surface px-2 py-px text-[11px] text-muted">v{version.version} 초안</span>
        {isSystem && (
          <label className="flex items-center gap-1.5">
            대상
            <select value={systemTarget} onChange={(e) => setSystemTarget(e.target.value as SystemTarget)} className="rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-bright">
              {REPORT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {PROMPT_DEFINITIONS[k].label}
                </option>
              ))}
              <option value="activity">운동 평가</option>
            </select>
          </label>
        )}
        {needsActivity && (candidates.length > 0 ? activitySelect : <span className="text-amber-300">시험할 수 있는 최근 활동이 없습니다</span>)}
        {!needsActivity && <span className="min-w-0 flex-1">지금 시점 기준으로 한 번 만들어 봅니다. 리포트 목록에는 저장되지 않습니다.</span>}
        <span className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-dim">{QUOTA_TEXT}</span>
          <button type="button" className={PRIMARY} disabled={busy || pending || (needsActivity && !activityId)} onClick={start}>
            시험 실행
          </button>
          <button type="button" className={BTN} onClick={onClose}>
            닫기
          </button>
        </span>
      </div>

      <div className="grid gap-2.5 p-3.5">
        {error && <p className="rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-300">{error}</p>}
        {pollError && <p className="text-xs text-amber-300">{pollError}</p>}
        {pending && (
          <p className="flex items-center gap-2 text-[13px] text-sub">
            <Spinner />
            시험 실행 중입니다 — 끝나면 지금 쓰는 버전의 최근 결과와 나란히 보여 줍니다
          </p>
        )}
        {run?.status === "failed" && <p className="rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-300">시험 실행이 실패했습니다 — {run.errorMessage ?? "알 수 없는 오류"}</p>}
        {run?.status === "done" && run.response !== null && (
          <div className="grid min-w-0 gap-2.5 md:grid-cols-2">
            <ResultDoc
              markdown={run.response}
              header={
                <>
                  <span className="rounded-full border border-dashed border-border-hover px-1.5 text-[11px] text-muted">v{version.version} 시험</span>
                  {formatPromptDateTime(run.startedAt)} 실행{durationText(run) ? ` · ${durationText(run)}` : ""}
                </>
              }
            />
            {actual ? (
              <ResultDoc
                markdown={actual.response}
                header={
                  <>
                    <span className="rounded-full bg-[rgba(34,197,94,0.12)] px-1.5 text-[11px] text-accent">실제</span>
                    {actual.reportDate ? actual.reportDate.slice(5) : formatPromptDate(actual.createdAt)} {targetText(run, activities)}
                  </>
                }
              />
            ) : (
              <p className="rounded-xl border border-dashed border-border px-3.5 py-6 text-center text-xs text-sub">비교할 실제 결과가 없습니다</p>
            )}
          </div>
        )}
        {!run && !pending && <p className="py-4 text-center text-xs text-sub">시험 결과가 여기 나오고, 같은 대상의 최근 실제 결과와 나란히 보여 줍니다.</p>}

        {runs.length > 0 && (
          <ul aria-label="시험 기록" className="border-t border-border pt-2 text-xs">
            {runs.map((r) => (
              <li key={r.id} className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2.5 py-1">
                <span className="font-mono text-dim">{formatPromptDateTime(r.startedAt)}</span>
                <span className={r.status === "done" ? "text-accent" : r.status === "failed" ? "text-red-300" : "text-sub"}>{r.status === "done" ? "완료" : r.status === "failed" ? "실패" : "실행 중"}</span>
                <span className="truncate text-sub">
                  {targetText(r, activities)}
                  {r.status === "failed" && r.errorMessage ? ` · ${r.errorMessage}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
