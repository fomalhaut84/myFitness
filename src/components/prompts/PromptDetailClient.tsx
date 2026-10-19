"use client";
// #552 U2 · U3 · U4: 프롬프트 상세 — 사용 중 버전에서 고치기 · 초안 저장 / 저장하고 활성화 · 계보에서 두 버전 비교 · 활성화 · 되돌리기.
// 코드 기본값 갱신 초안 (R2) 은 비교에서 "사용 중 버전에서 고치기" 로 차이를 옆에 두고 직접 반영한다 (자동 병합 없음).
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PROMPT_DEFINITIONS, PROMPT_NOTE_MAX_LENGTH, type PromptKey } from "@/lib/prompts/definitions";
import { isRemovedToolsAcknowledged, removedToolMentions, removedToolsKey, removedToolsMessage, toolMentions, validatePrompt } from "@/lib/prompts/validate";
import type { TrialLimits } from "@/lib/prompts/run-plan";
import type { PromptRunDTO } from "@/lib/prompts/runs";
import type { PromptVersionDTO } from "@/lib/prompts/versions";
import DiffView, { DiffStatsText } from "./DiffView";
import PromptEditor from "./PromptEditor";
import SuggestPanel from "./SuggestPanel";
import TrialPanel, { type TrialActivity } from "./TrialPanel";
import { StatusPill } from "./PromptPills";
import ValidationPanel from "./ValidationPanel";
import VersionRail from "./VersionRail";

const BTN = "rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] hover:border-border-hover disabled:cursor-not-allowed disabled:opacity-45";
const PRIMARY = "rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-[#04130a] hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45";

type Message = { kind: "ok" | "error"; text: string } | null;

/** 활성화 · 되돌리기가 TOOLS_REMOVED (409) 로 막혔을 때 — 확인 후 같은 요청을 acknowledgeRemovedTools 로 다시 */
interface PendingConfirm {
  text: string;
  url: string;
  label: string;
  success: (data: Record<string, unknown>) => string;
  fallback: string;
}

interface Props {
  promptKey: PromptKey;
  versions: readonly PromptVersionDTO[];
  /** 버전 id → 그 버전으로 만든 결과 수 (M19-2 L5) */
  resultCounts: Readonly<Record<string, number>>;
  /** M19-3: 이 프롬프트의 개선안 · 시험 기록 (최신순) */
  runs: readonly PromptRunDTO[];
  /** M19-3 T4: 시험 대상 후보 (최근 활동) */
  activities: readonly TrialActivity[];
  /** #562: 시험 실행 상한 안내 */
  trialLimits: TrialLimits;
}

async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

/** 다시 열었을 때 이어 볼 개선안 — 사용 중 버전 기준의 최신 기록이 실행 중이거나 30분 안에 끝났을 때만 */
const SUGGEST_RESUME_MS = 30 * 60_000;
function latestSuggestRun(runs: readonly PromptRunDTO[], activeId: string | null): PromptRunDTO | null {
  const latest = runs.find((r) => r.kind === "suggest") ?? null;
  if (!latest || latest.versionId !== activeId) return null;
  if (latest.status === "running") return latest;
  return latest.completedAt && Date.now() - Date.parse(latest.completedAt) < SUGGEST_RESUME_MS ? latest : null;
}

function errorText(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === "string" ? data.error : fallback;
}

export default function PromptDetailClient({ promptKey, versions, resultCounts, runs, activities, trialLimits }: Props) {
  const router = useRouter();
  const active = versions.find((v) => v.status === "active") ?? null;
  const baseBody = active?.body ?? PROMPT_DEFINITIONS[promptKey].defaultBody;

  const [body, setBody] = useState(baseBody);
  const [note, setNote] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [jumpTo, setJumpTo] = useState<{ line: number; seq: number } | null>(null);
  /** 확인한 시점의 빠진 도구 목록 (removedToolsKey) — 목록이 바뀌면 확인이 풀린다 */
  const [ackFor, setAckFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [trialId, setTrialId] = useState<string | null>(null);
  // SuggestPanel 은 처음 값만 쓴다 — 첫 렌더 시점 기준 (Date.now 를 렌더마다 부르지 않게)
  const [suggestRun] = useState(() => latestSuggestRun(runs, active?.id ?? null));

  // 저장 · 활성화 뒤 router.refresh 로 사용 중 본문이 바뀌면 편집 상태를 새로 시작 (메시지는 남긴다)
  const [prevBase, setPrevBase] = useState(baseBody);
  if (prevBase !== baseBody) {
    setPrevBase(baseBody);
    setBody(baseBody);
    setNote("");
    setReferenceId(null);
    setCompareIds([]);
    setAckFor(null);
    setConfirm(null);
  }

  const validation = useMemo(() => validatePrompt(promptKey, body), [promptKey, body]);
  // #203: 필수 문구 밖의 도구 언급이 빠지면 활성화 전에 확인받는다 (서버도 같은 조건으로 409)
  // 사용 중 버전이 없으면 코드 기본값이 쓰이는 중이라 baseBody (= 기본값) 와 비교한다 (사전 리뷰 info 4)
  const removedTools = useMemo(() => removedToolMentions(baseBody, body), [baseBody, body]);
  const toolCount = useMemo(() => toolMentions(body).length, [body]);
  const toolsAck = removedTools.length > 0 && isRemovedToolsAcknowledged(ackFor, removedTools);
  const activateBlocked = !isRemovedToolsAcknowledged(ackFor, removedTools);
  const dirty = body !== baseBody;
  const byId = (id: string | null) => versions.find((v) => v.id === id) ?? null;
  const reference = byId(referenceId);
  // R2: 웹에서 고친 버전을 쓰는 중에 들어온 더 새 코드 기본값 초안
  const pendingDefault = active ? (versions.find((v) => v.status === "draft" && v.source === "code_default" && v.version > active.version) ?? null) : null;
  const compared = compareIds
    .map(byId)
    .filter((v): v is PromptVersionDTO => v !== null)
    .sort((a, b) => a.version - b.version);
  // 시험 패널은 초안에만 — 활성화 · 되돌리기로 초안이 아니게 되면 닫힌다
  const trialVersion = versions.find((v) => v.id === trialId && v.status === "draft") ?? null;
  const comparedRemoved = compared.length === 2 ? removedToolMentions(compared[0].body, compared[1].body) : [];

  async function run(
    action: () => Promise<{ ok: boolean; data: Record<string, unknown> }>,
    success: (data: Record<string, unknown>) => string,
    fallback: string,
    onSuccess?: () => void,
    onFailure?: (data: Record<string, unknown>) => boolean,
  ) {
    setBusy(true);
    setMessage(null);
    setConfirm(null);
    try {
      const { ok, data } = await action();
      if (!ok) {
        if (onFailure?.(data)) return;
        setMessage({ kind: "error", text: errorText(data, fallback) });
        return;
      }
      setMessage({ kind: "ok", text: success(data) });
      onSuccess?.();
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: `${fallback} — 네트워크 오류` });
    } finally {
      setBusy(false);
    }
  }

  function save(activate: boolean) {
    return run(
      () => postJson(`/api/prompts/${promptKey}/versions`, { body, note, basedOnId: active?.id ?? null, activate, acknowledgeRemovedTools: toolsAck }),
      (d) => (activate ? `v${d.version} 를 사용합니다` : `v${d.version} 초안을 저장했습니다 — 오른쪽 버전 목록에서 활성화할 수 있습니다`),
      "저장하지 못했습니다",
      // 사전 리뷰 info 1: 초안 저장 뒤 편집기를 사용 중 본문으로 — 같은 초안이 반복 저장되지 않게
      () => {
        setBody(baseBody);
        setNote("");
        setAckFor(null);
      },
    );
  }

  /** 사전 리뷰 info 2: 활성화 · 되돌리기는 사용 중 본문을 바꿔 편집 중인 내용을 덮는다 — 먼저 저장하거나 되돌리게 */
  function switchVersion(url: string, label: string, success: (data: Record<string, unknown>) => string, fallback: string) {
    if (dirty) {
      setMessage({ kind: "error", text: "편집 중인 변경이 있습니다. 초안으로 저장하거나 되돌린 뒤 다시 시도하세요" });
      return;
    }
    return run(() => postJson(url), success, fallback, undefined, (data) => {
      if (data.code !== "TOOLS_REMOVED") return false;
      setConfirm({ text: errorText(data, fallback), url, label, success, fallback });
      return true;
    });
  }

  function confirmSwitch(pending: PendingConfirm) {
    // 확인 상자를 띄운 뒤 편집했으면 같은 이유로 막는다 (사전 리뷰 info 2)
    if (dirty) {
      setConfirm(null);
      setMessage({ kind: "error", text: "편집 중인 변경이 있습니다. 초안으로 저장하거나 되돌린 뒤 다시 시도하세요" });
      return;
    }
    return run(() => postJson(pending.url, { acknowledgeRemovedTools: true }), pending.success, pending.fallback);
  }

  function toggleCompare(id: string) {
    setTrialId(null);
    setCompareIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids.slice(-1), id]));
  }

  function editWithReference(id: string) {
    setReferenceId(id);
    setCompareIds([]);
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="grid min-w-0 gap-3">
        {promptKey === "system" && (
          <p className="rounded-lg bg-amber-900/40 px-3 py-2 text-xs text-amber-100">
            저장하고 활성화하면 웹 채팅 · 텔레그램 · 리포트 · 운동 평가에 바로 적용됩니다. 이어지던 대화는 다음 질문부터 새로 시작합니다. 사용자 프로필 · HR 존 · 현재 시각 · 개인 목표는 이 프롬프트 뒤에 자동으로 붙습니다.
          </p>
        )}
        {pendingDefault && active && (
          <p className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-900/40 px-3 py-2 text-xs text-amber-100">
            <span>
              <b className="font-medium text-amber-300">코드 기본값이 바뀌었습니다.</b> 웹에서 고친 v{active.version} 을 쓰고 있어 새 기본값을 v{pendingDefault.version} 초안으로 넣어 두었습니다.
            </span>
            <button type="button" className="ml-auto rounded-md border border-amber-300/40 px-2 py-0.5 text-amber-200 hover:border-amber-300" onClick={() => setCompareIds([active.id, pendingDefault.id])}>
              차이 보기
            </button>
          </p>
        )}
        {confirm && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-900/40 px-3 py-2 text-xs text-amber-100">
            <span className="min-w-0 flex-1">{confirm.text}. 활성화 뒤 다음 리포트에 그 항목이 나오는지 확인하세요.</span>
            <button type="button" className="rounded-md border border-amber-300/40 px-2 py-0.5 text-amber-200 hover:border-amber-300" disabled={busy} onClick={() => confirmSwitch(confirm)}>
              {confirm.label}
            </button>
            <button type="button" className="px-1 text-sub hover:text-bright" onClick={() => setConfirm(null)}>
              취소
            </button>
          </div>
        )}
        {message && (
          <p role="status" className={`rounded-lg px-3 py-2 text-xs ${message.kind === "ok" ? "bg-[rgba(34,197,94,0.12)] text-accent" : "bg-red-950/60 text-red-300"}`}>
            {message.text}
          </p>
        )}

        <SuggestPanel promptKey={promptKey} versions={versions} initialRun={suggestRun} />

        {trialVersion ? (
          <TrialPanel
            key={trialVersion.id}
            promptKey={promptKey}
            version={trialVersion}
            activities={activities}
            runs={runs.filter((r) => r.kind === "trial" && r.versionId === trialVersion.id)}
            limits={trialLimits}
            onClose={() => setTrialId(null)}
          />
        ) : compared.length === 2 ? (
          <section className="min-w-0 rounded-xl border border-border bg-card" aria-label="버전 비교">
            <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-3.5 py-2.5 text-xs text-sub">
              <span className="font-mono text-bright">v{compared[0].version}</span>
              <StatusPill status={compared[0].status} />
              <span aria-hidden>↔</span>
              <span className="font-mono text-bright">v{compared[1].version}</span>
              <StatusPill status={compared[1].status} />
              <DiffStatsText oldText={compared[0].body} newText={compared[1].body} />
              {comparedRemoved.length > 0 && <span className="text-amber-300">v{compared[1].version} 에서 빠진 도구: {comparedRemoved.join(" · ")}</span>}
              <span className="ml-auto flex flex-wrap gap-1.5">
                {active && compared.some((v) => v.id === active.id) && compared.some((v) => v.status === "draft") && (
                  <button type="button" className={BTN} onClick={() => editWithReference(compared.find((v) => v.status === "draft")!.id)}>
                    사용 중 버전에서 고치기
                  </button>
                )}
                {compared
                  .filter((v) => v.status === "draft")
                  .map((v) => (
                    <button key={v.id} type="button" className={PRIMARY} disabled={busy} onClick={() => switchVersion(`/api/prompts/versions/${v.id}/activate`, `v${v.version} 그래도 활성화`, () => `v${v.version} 를 사용합니다`, "활성화하지 못했습니다")}>
                      v{v.version} 활성화
                    </button>
                  ))}
                <button type="button" className={BTN} onClick={() => setCompareIds([])}>
                  닫기
                </button>
              </span>
            </div>
            <DiffView oldText={compared[0].body} newText={compared[1].body} />
          </section>
        ) : (
          <section className="min-w-0 rounded-xl border border-border bg-card" aria-label="편집">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3.5 py-2.5 text-xs text-sub">
              <span>
                {active ? (
                  <>
                    <b className="font-medium text-bright">v{active.version}</b> 에서 고치는 중
                  </>
                ) : (
                  "코드 기본값에서 고치는 중"
                )}
                {dirty && <span className="ml-2 text-amber-300">· 저장 안 됨</span>}
              </span>
              {PROMPT_DEFINITIONS[promptKey].variables.length > 0 && (
                <span className="flex flex-wrap items-center gap-1.5">
                  변수
                  {PROMPT_DEFINITIONS[promptKey].variables.map((v) => (
                    <code key={v.name} title={v.description} className="rounded bg-amber-300/10 px-1.5 font-mono text-[11px] text-amber-300">
                      {`{{${v.name}}}`}
                    </code>
                  ))}
                </span>
              )}
            </div>
            <PromptEditor promptKey={promptKey} value={body} onChange={setBody} jumpTo={jumpTo} />
            <ValidationPanel
              promptKey={promptKey}
              validation={validation}
              removedToolsText={removedTools.length > 0 ? removedToolsMessage(removedTools) : null}
              toolCount={toolCount}
              onJump={(line) => setJumpTo({ line, seq: Date.now() })}
            />
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-3.5 py-2.5">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={PROMPT_NOTE_MAX_LENGTH}
                placeholder="무엇을 바꿨나요? (예: 혈압 항목을 경고 위주로)"
                aria-label="변경 메모"
                className="min-w-[200px] flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-bright placeholder:text-dim"
              />
              {dirty && (
                <button type="button" className="rounded-lg px-2 py-1.5 text-[13px] text-sub hover:text-bright" disabled={busy} onClick={() => {
                    setBody(baseBody);
                    setAckFor(null);
                  }}>
                  되돌리기
                </button>
              )}
              <button type="button" className={BTN} disabled={busy || !dirty || validation.errors.length > 0} onClick={() => save(false)}>
                초안 저장
              </button>
              {removedTools.length > 0 && (
                <label className="inline-flex w-full cursor-pointer items-center gap-1.5 text-xs text-amber-300 sm:order-first sm:w-auto">
                  <input type="checkbox" checked={toolsAck} onChange={(e) => setAckFor(e.target.checked ? removedToolsKey(removedTools) : null)} className="accent-amber-300" />
                  빠진 도구를 확인했습니다 (활성화에 필요)
                </label>
              )}
              <button type="button" className={PRIMARY} disabled={busy || !dirty || validation.errors.length > 0 || activateBlocked} onClick={() => save(true)}>
                저장하고 활성화
              </button>
            </div>
            {reference && (
              <div className="border-t border-border">
                <div className="flex items-center gap-2 px-3.5 pt-2.5 text-xs text-sub">
                  참고: 사용 중 → <span className="font-mono text-bright">v{reference.version}</span> 차이 — 필요한 줄을 위 편집기에 직접 옮기세요
                  <button type="button" className="ml-auto text-sub hover:text-bright" onClick={() => setReferenceId(null)}>
                    닫기
                  </button>
                </div>
                <DiffView oldText={baseBody} newText={reference.body} />
              </div>
            )}
          </section>
        )}
      </div>

      <VersionRail
        versions={versions}
        resultCounts={resultCounts}
        compareIds={compareIds}
        busy={busy}
        onToggleCompare={toggleCompare}
        onActivate={(v) => switchVersion(`/api/prompts/versions/${v.id}/activate`, `v${v.version} 그래도 활성화`, () => `v${v.version} 를 사용합니다`, "활성화하지 못했습니다")}
        onRestore={(v) => switchVersion(`/api/prompts/versions/${v.id}/restore`, `v${v.version} 로 그래도 되돌리기`, (d) => `v${v.version} 를 v${d.version} 로 되돌렸습니다`, "되돌리지 못했습니다")}
        onTrial={(v) => {
          setCompareIds([]);
          setTrialId((id) => (id === v.id ? null : v.id));
        }}
        trialId={trialVersion?.id ?? null}
      />
    </div>
  );
}
