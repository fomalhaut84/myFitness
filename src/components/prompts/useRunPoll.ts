"use client";
// #552 M19-3: 개선안 · 시험 실행 job 폴링 — running 이면 3초마다 `GET /api/prompts/runs/[id]`. 끝난 시험은 실제 결과 (actual) 도 받는다.
import { useEffect, useState } from "react";
import type { PromptRunDTO } from "@/lib/prompts/runs";
import type { ActualResultDTO } from "@/lib/prompts/trial";

const POLL_MS = 3_000;

interface RunState {
  id: string | null;
  run: PromptRunDTO | null;
  actual: ActualResultDTO | null;
  /** 조회 완료 횟수 — 0 이면 바로 조회 (처음 받은 끝난 시험도 actual 을 받으려고 한 번은), 그 뒤는 POLL_MS 간격 */
  attempt: number;
  /** 더 조회해도 같은 결과 (404 등) */
  stopped: boolean;
  error: string | null;
}

const EMPTY: RunState = { id: null, run: null, actual: null, attempt: 0, stopped: false, error: null };

export default function useRunPoll(initial: PromptRunDTO | null) {
  const [state, setState] = useState<RunState>(initial ? { ...EMPTY, id: initial.id, run: initial } : EMPTY);
  const { id, attempt, stopped } = state;
  const settled = state.run !== null && state.run.status !== "running" && attempt > 0;

  useEffect(() => {
    if (!id || stopped || settled) return;
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        try {
          const res = await fetch(`/api/prompts/runs/${id}`);
          const data = (await res.json().catch(() => ({}))) as { run?: PromptRunDTO; actual?: ActualResultDTO | null; error?: string };
          if (cancelled) return;
          if (!res.ok || !data.run) {
            setState((s) => ({ ...s, attempt: s.attempt + 1, stopped: true, error: data.error ?? "실행 상태를 불러오지 못했습니다" }));
            return;
          }
          setState((s) => ({ ...s, run: data.run!, actual: data.actual ?? null, attempt: s.attempt + 1, error: null }));
        } catch {
          // 네트워크 오류는 일시적일 수 있다 — 표시하고 다음 주기에 다시
          if (!cancelled) setState((s) => ({ ...s, attempt: s.attempt + 1, error: "실행 상태를 불러오지 못했습니다 — 다시 시도 중" }));
        }
      },
      attempt === 0 ? 0 : POLL_MS,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, attempt, stopped, settled]);

  return {
    run: state.run,
    actual: state.actual,
    error: state.error,
    /** 시작했고 끝나지 않음 — 첫 조회 전 (run 없음) 포함. 버튼 비활성에 쓴다 */
    pending: id !== null && !stopped && (state.run === null || state.run.status === "running"),
    /** 새로 시작한 job 추적 */
    track: (runId: string) => setState({ ...EMPTY, id: runId }),
    clear: () => setState(EMPTY),
  };
}
