"use client";

// #532: 쪽별 읽기 진행 — 대기 · 변환 · 읽는 중 · 완료 (항목 수) · 실패 (다시 읽기). 표가 없는 쪽은 실패와 구분.
export type PageStatus = "waiting" | "working" | "done" | "error";

export interface PageProgress {
  id: string;
  label: string;
  status: PageStatus;
  items: number;
  error: string | null;
}

interface ReadProgressProps {
  pages: readonly PageProgress[];
  running: boolean;
  onRetry: (ids: string[]) => void;
  onReset: () => void;
  onCancel: () => void;
  onContinue: () => void;
}

export default function ReadProgress({ pages, running, onRetry, onReset, onCancel, onContinue }: ReadProgressProps) {
  const finished = pages.filter((p) => p.status === "done" || p.status === "error").length;
  const failedIds = pages.filter((p) => p.status === "error").map((p) => p.id);
  const failed = failedIds.length;
  const readable = pages.some((p) => p.status === "done" && p.items > 0);
  const pct = pages.length ? Math.round((finished / pages.length) * 100) : 0;

  return (
    <section aria-labelledby="progress-title" className="bg-card border border-border rounded-xl p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="progress-title" className="text-[15px] font-medium text-bright">
          {running ? "결과지 읽는 중" : failed > 0 ? `${failed}쪽 못 읽음` : "읽기 끝"} · {finished} / {pages.length}
        </h2>
        <div className="flex gap-2">
          {running ? (
            <button type="button" onClick={onCancel} className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs hover:border-border-hover">
              취소
            </button>
          ) : (
            <>
              <button type="button" onClick={onReset} className="rounded-lg px-2.5 py-1.5 text-sm text-sub hover:text-bright">
                다른 파일로
              </button>
              {failed > 0 && (
                <button
                  type="button"
                  onClick={() => onRetry(failedIds)}
                  className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:border-border-hover"
                >
                  남은 {failed}쪽 다시 읽기
                </button>
              )}
              <button
                type="button"
                disabled={!readable}
                onClick={onContinue}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-[#04130a] hover:bg-accent-hover disabled:opacity-40"
              >
                {failed > 0 ? `${failed}쪽 빼고 확인하기` : "확인하기"}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="mb-3.5 h-1 overflow-hidden rounded-sm bg-surface" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <i className="block h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      {!running && !readable && <p className="mb-2 text-sm text-sub">읽은 항목이 없습니다. 결과 표가 보이는 이미지인지 확인하세요.</p>}
      <ul>
        {pages.map((p) => (
          <li key={p.id} className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-border py-2">
            <span className="truncate text-[13px] text-bright">{p.label}</span>
            <PageState page={p} onRetry={() => onRetry([p.id])} retryDisabled={running} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PageState({ page, onRetry, retryDisabled }: { page: PageProgress; onRetry: () => void; retryDisabled: boolean }) {
  const mono = "font-[family-name:var(--font-geist-mono)] text-xs";
  if (page.status === "waiting") return <span className={`${mono} text-sub`}>대기</span>;
  if (page.status === "working") return <span className={`${mono} text-blue-300`}>읽는 중…</span>;
  if (page.status === "done") {
    return (
      <span className={`${mono} text-accent`}>{page.items > 0 ? `항목 ${page.items}개` : "항목 0개 — 결과 표가 없는 쪽"}</span>
    );
  }
  return (
    <span className={`${mono} text-red-400`}>
      {page.error ?? "읽지 못함"} ·{" "}
      <button type="button" disabled={retryDisabled} onClick={onRetry} className="underline disabled:opacity-50">
        다시 읽기
      </button>
    </span>
  );
}
