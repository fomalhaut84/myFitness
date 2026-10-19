"use client";
// #552 M19-2 L4: 결과 탭 — 버전 필터 칩 · 결과 목록 · 두 결과 나란히. 기본 선택은 최신 + 다른 버전의 최신 (pickDefaultPair)
import { useRef, useState } from "react";
import type { PromptKey } from "@/lib/prompts/definitions";
import type { PromptResultDTO } from "@/lib/prompts/results";
import { NO_VERSION, pickDefaultPair } from "@/lib/prompts/results-query";
import type { PromptVersionDTO } from "@/lib/prompts/versions";
import ResultDoc from "./ResultDoc";
import { categoryLabel, firstLine, resultDate } from "./result-labels";

interface Props {
  promptKey: PromptKey;
  versions: readonly PromptVersionDTO[];
  initialResults: readonly PromptResultDTO[];
}

const CHIP = "rounded-full border px-2.5 py-0.5 font-mono text-xs";

function VersionBadge({ versionId, versionNo, activeId }: { versionId: string | null; versionNo: Map<string, number>; activeId: string | null }) {
  if (versionId === null) return <span className="whitespace-nowrap rounded-full border border-border px-1.5 text-[11px] text-dim">버전 없음</span>;
  const active = versionId === activeId;
  return (
    <span className={`whitespace-nowrap rounded-full px-1.5 text-[11px] ${active ? "bg-[rgba(34,197,94,0.12)] text-accent" : "bg-surface-hover text-bright"}`}>
      v{versionNo.get(versionId) ?? "?"}
    </span>
  );
}

export default function ResultsTab({ promptKey, versions, initialResults }: Props) {
  const [filter, setFilter] = useState<string[]>([]);
  const [results, setResults] = useState<readonly PromptResultDTO[]>(initialResults);
  const [selected, setSelected] = useState<string[]>(() => pickDefaultPair(initialResults));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 마지막 요청 번호 — 늦게 도착한 이전 필터 응답이 화면을 덮지 않게 (사전 리뷰 major 2) */
  const requestSeq = useRef(0);

  const versionNo = new Map(versions.map((v) => [v.id, v.version]));
  const activeId = versions.find((v) => v.status === "active")?.id ?? null;
  const chips = [...versions.map((v) => ({ id: v.id, label: `v${v.version}` })), { id: NO_VERSION, label: "버전 정보 없음" }];
  const showCategory = promptKey === "system";

  async function applyFilter(next: string[]) {
    const seq = ++requestSeq.current;
    const isLatest = () => seq === requestSeq.current;
    setFilter(next);
    setLoading(true);
    setError(null);
    try {
      const qs = next.length > 0 ? `?versions=${encodeURIComponent(next.join(","))}` : "";
      const res = await fetch(`/api/prompts/${promptKey}/results${qs}`);
      const data = (await res.json().catch(() => ({}))) as { results?: PromptResultDTO[]; error?: string };
      if (!isLatest()) return;
      if (!res.ok || !data.results) {
        setError(data.error ?? "결과를 불러오지 못했습니다");
        return;
      }
      setResults(data.results);
      setSelected(pickDefaultPair(data.results));
    } catch {
      if (isLatest()) setError("결과를 불러오지 못했습니다 — 네트워크 오류");
    } finally {
      if (isLatest()) setLoading(false);
    }
  }

  function toggleChip(id: string) {
    void applyFilter(filter.includes(id) ? filter.filter((x) => x !== id) : [...filter, id]);
  }

  function toggleSelect(id: string) {
    setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids.slice(-1), id]));
  }

  const shown = selected.map((id) => results.find((r) => r.id === id)).filter((r): r is PromptResultDTO => r !== undefined);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="버전 필터">
        <button type="button" aria-pressed={filter.length === 0} onClick={() => void applyFilter([])} className={`${CHIP} ${filter.length === 0 ? "border-accent bg-[rgba(34,197,94,0.12)] text-accent" : "border-border text-sub hover:text-bright"}`}>
          전체
        </button>
        {chips.map((c) => {
          const on = filter.includes(c.id);
          return (
            <button key={c.id} type="button" aria-pressed={on} onClick={() => toggleChip(c.id)} className={`${CHIP} ${on ? "border-accent bg-[rgba(34,197,94,0.12)] text-accent" : "border-border text-sub hover:text-bright"}`}>
              {c.label}
            </button>
          );
        })}
        {loading && <span className="self-center text-xs text-dim">불러오는 중…</span>}
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-300">{error}</p>}

      {results.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-6 py-10 text-center text-sm text-sub">
          {filter.length === 0 ? "아직 이 프롬프트로 만든 결과가 없습니다. 리포트나 평가가 생성되면 여기에 쌓입니다." : "고른 버전의 결과가 없습니다."}
        </div>
      ) : (
        <div className="grid items-start gap-3.5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <ul className="max-h-[640px] overflow-y-auto rounded-xl border border-border bg-card py-1" aria-label="결과 목록 — 두 개를 고르면 나란히 봅니다">
            {results.map((r) => {
              const on = selected.includes(r.id);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleSelect(r.id)}
                    className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-2.5 gap-y-1 border-t border-border px-3 py-2 text-left text-xs first:border-t-0 ${on ? "bg-surface shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-surface"}`}
                  >
                    <span className="font-mono text-bright">{resultDate(r.reportDate, r.createdAt)}</span>
                    <span className="truncate text-sub">{showCategory ? categoryLabel(r.category) : ""}</span>
                    <VersionBadge versionId={r.versionId} versionNo={versionNo} activeId={activeId} />
                    <span className="col-span-3 truncate text-sub">{firstLine(r.response)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="grid min-w-0 gap-2.5 md:grid-cols-2">
            {shown.length === 0 ? (
              <p className="text-sm text-sub md:col-span-2">왼쪽에서 결과를 고르세요. 두 개를 고르면 나란히 봅니다.</p>
            ) : (
              shown.map((r) => (
                <ResultDoc
                  key={r.id}
                  markdown={r.response}
                  header={
                    <>
                      <VersionBadge versionId={r.versionId} versionNo={versionNo} activeId={activeId} />
                      {resultDate(r.reportDate, r.createdAt)} {categoryLabel(r.category)}
                    </>
                  }
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
