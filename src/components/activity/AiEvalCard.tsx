"use client";

// #440: 활동 AI 평가 카드 — 상태 4개 (대기 · 분석 중 · 결과 · 오류). 근거 칩은 서버 응답의 `sections` 로 그린다 (모델 응답을 파싱하지 않는다).
// 시안 `docs/designs/440-activity-ai-eval/`.
import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { Marked } from "marked";
import { formatEpochKST } from "@/lib/format";

interface EvalSectionRef {
  id: string;
  title: string;
}

interface EvalOmittedRef extends EvalSectionRef {
  reason: string;
}

export interface EvalResponse {
  result: string;
  mode: "full" | "brief";
  sections: EvalSectionRef[];
  omitted: EvalOmittedRef[];
  model: string;
  duration_ms?: number;
}

type State =
  | { status: "idle" }
  | { status: "loading"; startedAt: number }
  | { status: "done"; data: EvalResponse; finishedAt: number }
  | { status: "error"; message: string };

/** 줄 단위 — `#### 종합` 같은 변형에 걸리지 않게 (사전 리뷰 info 3) */
const SUMMARY_HEADING = /^###\s+종합\s*$/m;
const TYPICAL_RANGE = "보통 30~90초";

/** 모델 마크다운 → 안전한 HTML. `### 종합` 앞뒤를 나눠 종합 문단만 강조한다 */
function splitSummary(markdown: string): { body: string; summary: string | null } {
  const at = markdown.search(SUMMARY_HEADING);
  if (at < 0) return { body: markdown, summary: null };
  return { body: markdown.slice(0, at), summary: markdown.slice(at) };
}

/**
 * 취소선 토크나이저를 끈 파서 — 모델이 범위를 `120~130bpm` 처럼 쓰면 GFM 이 `~…~` 를 취소선으로 읽는다 (실화면 검증에서 발견).
 * 텍스트를 고쳐 쓰지 않고 (코드 안 물결표 · 이미 이스케이프된 물결표가 깨진다 — 사전 리뷰 info 2) 토크나이저에서 뺀다.
 */
const parser = new Marked({ tokenizer: { del: () => undefined } });

function toHtml(markdown: string): string {
  return DOMPurify.sanitize(parser.parse(markdown, { async: false }) as string);
}

const PROSE =
  "text-[13px] text-text leading-relaxed [&_h3]:text-[11px] [&_h3]:font-medium [&_h3]:text-dim [&_h3]:tracking-wider [&_h3]:uppercase [&_h3]:mt-4 [&_h3]:mb-1 [&_h3:first-child]:mt-0 [&_p]:my-1 [&_strong]:text-bright [&_strong]:font-medium [&_ul]:pl-[18px] [&_ul]:list-disc [&_li]:my-0.5";

function ElapsedSeconds({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{Math.max(0, Math.floor((now - since) / 1000))}초</>;
}

function Chips({ data }: { data: EvalResponse }) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-4">
      <span className="text-[11px] text-dim tracking-wider uppercase leading-6 mr-0.5">근거</span>
      {data.sections.map((s) => (
        <span key={s.id} className="text-[11px] font-[family-name:var(--font-geist-mono)] text-sub border border-border rounded-full px-2 leading-[18px] py-0.5">
          {s.title}
        </span>
      ))}
      {data.omitted.map((o) => (
        <span
          key={o.id}
          title={o.reason}
          className="text-[11px] font-[family-name:var(--font-geist-mono)] text-dim border border-dashed border-border rounded-full px-2 leading-[18px] py-0.5"
        >
          {o.title} · 조회 실패
        </span>
      ))}
    </div>
  );
}

function ResultBody({ data }: { data: EvalResponse }) {
  const { body, summary } = splitSummary(data.result);
  return (
    <div>
      <div className={PROSE} dangerouslySetInnerHTML={{ __html: toHtml(body) }} />
      {summary !== null && (
        <div
          className={`mt-4 pl-3.5 py-0.5 border-l border-accent ${PROSE} [&_h3]:text-sub [&_p]:text-bright [&_p:has(strong:first-child)]:text-text [&_strong:first-child]:text-accent`}
          dangerouslySetInnerHTML={{ __html: toHtml(summary) }}
        />
      )}
    </div>
  );
}

function Button({ onClick, children, small = false, disabled = false }: { onClick: () => void; children: React.ReactNode; small?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${small ? "px-2.5 py-1 text-[11px]" : "px-4 py-2 text-[13px]"} rounded-lg border border-border text-sub hover:text-bright hover:border-border-hover transition-colors disabled:opacity-50`}
    >
      {children}
    </button>
  );
}

export default function AiEvalCard({ activityId }: { activityId: string }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function evaluate() {
    setState({ status: "loading", startedAt: Date.now() });
    try {
      const res = await fetch(`/api/activities/${activityId}/evaluate`, { method: "POST" });
      const data = (await res.json()) as Partial<EvalResponse> & { error?: string };
      if (!res.ok || typeof data.result !== "string") {
        throw new Error(data.error ?? `요청 실패 (${res.status})`);
      }
      setState({ status: "done", data: { ...data, sections: data.sections ?? [], omitted: data.omitted ?? [], mode: data.mode ?? "full", model: data.model ?? "" } as EvalResponse, finishedAt: Date.now() });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : "AI 평가를 불러올 수 없습니다." });
    }
  }

  if (state.status === "idle") {
    return (
      <div className="mt-6">
        <Button onClick={evaluate}>🤖 AI 평가 요청</Button>
      </div>
    );
  }

  const headerMeta = state.status === "done" ? `${formatEpochKST(state.finishedAt)} · ${Math.round((state.data.duration_ms ?? 0) / 1000)}초` : null;

  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between gap-3 mb-3 max-sm:flex-col max-sm:gap-1">
        <h2 className="text-lg font-semibold">AI 평가</h2>
        {headerMeta && <span className="text-[11px] font-[family-name:var(--font-geist-mono)] text-dim whitespace-nowrap">{headerMeta}</span>}
      </div>
      <div className="bg-card border border-border rounded-xl p-5 max-sm:px-3 max-sm:py-4">
        {state.status === "loading" && (
          <div className="flex items-center gap-3 text-[13px] text-sub">
            <span className="inline-flex gap-[3px]" aria-hidden>
              <span className="w-[5px] h-[5px] rounded-full bg-sub animate-pulse" />
              <span className="w-[5px] h-[5px] rounded-full bg-sub animate-pulse [animation-delay:200ms]" />
              <span className="w-[5px] h-[5px] rounded-full bg-sub animate-pulse [animation-delay:400ms]" />
            </span>
            상세 지표를 근거로 분석하고 있어요
            <span className="text-[12px] font-[family-name:var(--font-geist-mono)] text-dim">
              <ElapsedSeconds since={state.startedAt} /> · {TYPICAL_RANGE}
            </span>
          </div>
        )}

        {state.status === "error" && (
          <div className="flex items-center justify-between gap-3 text-[13px] text-sub max-sm:flex-col max-sm:items-start">
            <span>
              평가를 불러오지 못했어요. <code className="text-[12px] font-[family-name:var(--font-geist-mono)] text-dim">{state.message}</code>
            </span>
            <Button onClick={evaluate} small>
              다시 시도
            </Button>
          </div>
        )}

        {state.status === "done" && (
          <>
            {state.data.mode === "full" && <Chips data={state.data} />}
            <ResultBody data={state.data} />
            <div className="flex items-center justify-between gap-3 mt-4 pt-3.5 border-t border-border max-sm:flex-col max-sm:items-start">
              <span className="text-[11px] font-[family-name:var(--font-geist-mono)] text-dim">
                {state.data.model}
                {state.data.mode === "full"
                  ? ` · 근거 ${state.data.sections.length} / ${state.data.sections.length + state.data.omitted.length} 섹션`
                  : " · 요약"}
                {state.data.sections.some((s) => s.id === "recovery") ? " · 2분 해상도 HRR" : ""}
              </span>
              <Button onClick={evaluate} small>
                다시 평가
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
