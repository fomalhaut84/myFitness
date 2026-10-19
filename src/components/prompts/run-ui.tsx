// #552 M19-3: 개선안 · 시험 실행 패널 공용 — 버튼 스타일 · 쿼터 안내 (T5) · 진행 표시 · POST 헬퍼
export const BTN = "rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] hover:border-border-hover disabled:cursor-not-allowed disabled:opacity-45";
export const PRIMARY = "rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-[#04130a] hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45";
export const GHOST = "rounded-lg px-2 py-1.5 text-[13px] text-sub hover:text-bright disabled:opacity-45";
/** 시안의 AI 제안 색 (보라) */
export const AI_BTN = "rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-[13px] text-violet-300 hover:border-violet-400 disabled:cursor-not-allowed disabled:opacity-45";

export function Spinner() {
  return <span aria-hidden className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-border-hover border-t-violet-300 motion-reduce:animate-none" />;
}

export async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}
