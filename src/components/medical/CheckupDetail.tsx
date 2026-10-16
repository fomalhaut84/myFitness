"use client";

// #527 (2/2): 회차 상세 — 종합 소견 + 확인할 항목 → 섹션별 결과 (결과 · 범위 막대 · 기준범위 · 직전 대비) · 판독문 · 추적검사.
// 행 · 카드를 누르면 항목 추이 (ItemTrendDialog).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CheckupDetailDto, CheckupResultDto } from "@/lib/checkup/dto";
import { FLAG_LABEL, KIND_LABEL, flagTone, formatDelta, formatReference, formatResultValue } from "@/lib/checkup/view";
import { FLAG_PILL, valueClass } from "./flag-style";
import ItemTrendDialog from "./ItemTrendDialog";
import RangeRail from "./RangeRail";

interface CheckupDetailProps {
  checkup: CheckupDetailDto;
}

const MONO = "font-[family-name:var(--font-geist-mono)]";

function groupByCategory(results: readonly CheckupResultDto[]): [string, CheckupResultDto[]][] {
  // 결과는 이미 섹션 순서로 정렬돼 온다 (sortResults) — 순서를 유지하며 묶는다
  return results.reduce<[string, CheckupResultDto[]][]>((acc, r) => {
    const last = acc[acc.length - 1];
    return last && last[0] === r.category ? [...acc.slice(0, -1), [last[0], [...last[1], r]]] : [...acc, [r.category, [r]]];
  }, []);
}

function DeltaText({ r }: { r: CheckupResultDto }) {
  if (!r.previous) return <span className="text-dim">첫 기록</span>;
  const delta = formatDelta(r.itemCode, r, r.previous);
  const prevValue = formatResultValue({ itemCode: r.itemCode, ...r.previous });
  // 단위가 다르면 차이를 빼고 (formatDelta) 직전 값에 단위 · 표시를 붙여 직접 비교하지 않게 (PR #530 Codex P2)
  const unitDiffers = (r.previous.unit ?? null) !== (r.unit ?? null);
  return (
    <>
      {delta && <span className="text-sub">{delta} </span>}
      <span className="text-dim">
        ({r.previous.date.slice(0, 7)} {prevValue}
        {unitDiffers && r.previous.unit ? ` ${r.previous.unit}` : ""})
      </span>
      {unitDiffers && <span className="ml-1 text-amber-300">단위 다름</span>}
    </>
  );
}

export default function CheckupDetail({ checkup }: CheckupDetailProps) {
  const [trendCode, setTrendCode] = useState<string | null>(null);
  const watch = checkup.results.filter((r) => r.valueNum !== null && flagTone(r.flag));

  return (
    <div>
      <DetailHeader checkup={checkup} />

      {(checkup.summary || watch.length > 0 || checkup.findings.length > 0) && (
        <section aria-label="확인할 항목" className="bg-card border border-border rounded-xl px-4 py-3.5 mb-5">
          {checkup.summary && <p className="text-sm text-muted whitespace-pre-line">{checkup.summary}</p>}
          {checkup.findings.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-xs text-sub">
              {checkup.findings.map((f, i) => (
                <li key={i}>
                  <span className="text-dim">{f.category}</span> {f.text}
                </li>
              ))}
            </ul>
          )}
          {watch.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
              {watch.map((r) => {
                const tone = flagTone(r.flag)!;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setTrendCode(r.itemCode)}
                    className="rounded-lg border border-border bg-surface px-2.5 py-2 text-left hover:border-border-hover"
                  >
                    <span className="block text-xs text-sub">
                      {r.label} <span className={`text-[11px] ${valueClass(tone)}`}>{FLAG_LABEL[tone]}</span>
                    </span>
                    <span className={`block ${MONO} text-[15px] font-medium ${valueClass(tone)}`}>
                      {formatResultValue(r)}
                      {r.unit && <span className="ml-1 text-xs text-dim">{r.unit}</span>}
                    </span>
                    <span className={`block ${MONO} text-xs`}>
                      <DeltaText r={r} />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {groupByCategory(checkup.results).map(([category, rows]) => (
        <section key={category} className="mt-5" aria-labelledby={`cat-${category}`}>
          <h3 id={`cat-${category}`} className="mb-2 flex items-baseline gap-2 text-sm font-medium text-bright">
            {category}
            <small className="text-xs font-normal text-dim">{rows.length}개</small>
          </h3>
          <div className="bg-card border border-border rounded-xl">
            <div className={`hidden md:grid md:grid-cols-[22%_18%_174px_13%_1fr] border-b border-border px-3 py-2 text-[11px] text-dim`}>
              <span>항목</span>
              <span>결과</span>
              <span>범위 안 위치</span>
              <span>기준범위</span>
              <span>직전 대비</span>
            </div>
            {rows.map((r) => (
              <ResultRow key={r.id} r={r} onOpen={() => setTrendCode(r.itemCode)} />
            ))}
          </div>
        </section>
      ))}

      <ItemTrendDialog itemCode={trendCode} onClose={() => setTrendCode(null)} />
    </div>
  );
}

function ResultRow({ r, onOpen }: { r: CheckupResultDto; onOpen: () => void }) {
  const tone = flagTone(r.flag);
  const numeric = r.valueNum !== null;
  const prevNum = r.previous && (r.previous.unit ?? null) === (r.unit ?? null) ? r.previous.valueNum : null;
  const prevText = r.previous && prevNum !== null ? formatResultValue({ itemCode: r.itemCode, ...r.previous }) : null;
  const railLabel = `기준범위 ${r.refText ?? "없음"} 에서 이번 값 ${formatResultValue(r)}${prevText !== null ? `, 직전 ${prevText}` : ""}`;

  return (
    <div
      className="grid cursor-pointer grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-t border-border px-3 py-2.5 first:border-t-0 hover:bg-[#1a1a1a] md:grid-cols-[22%_18%_174px_13%_1fr] md:gap-y-0"
      onClick={onOpen}
    >
      <div className="min-w-0">
        <button type="button" onClick={onOpen} className="text-left text-sm text-bright hover:underline" aria-label={`${r.label} 추이 보기`}>
          {r.label}
        </button>
        {r.note && (
          <details className="mt-0.5" onClick={(e) => e.stopPropagation()}>
            <summary className="cursor-pointer text-xs text-sub">판독문</summary>
            <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-surface px-3 py-2 text-xs leading-relaxed text-muted">{r.note}</p>
          </details>
        )}
        {r.followUpDue && (
          <p className="mt-1 text-xs text-amber-300">
            추적검사 {r.followUpDue}
            {r.followUp ? ` · ${r.followUp}` : ""}
          </p>
        )}
      </div>

      <div className="text-right md:text-left">
        {numeric ? (
          <span className={`${MONO} whitespace-nowrap text-sm font-medium ${valueClass(tone)}`}>
            {formatResultValue(r)}
            {r.unit && <span className="ml-1 text-xs font-normal text-dim">{r.unit}</span>}
            {tone && <span className="ml-1.5 text-[11px] font-normal">{FLAG_LABEL[tone]}</span>}
          </span>
        ) : (
          <span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-xs ${tone ? FLAG_PILL[tone] : "bg-surface text-muted"}`}>
            {formatResultValue(r)}
          </span>
        )}
      </div>

      <div className="col-span-2 md:col-span-1">
        {numeric && <RangeRail value={r.valueNum!} previous={prevNum} refLow={r.refLow} refHigh={r.refHigh} tone={tone} label={railLabel} />}
      </div>

      <div className={`hidden ${MONO} text-xs text-sub md:block`}>{formatReference(r)}</div>

      <div className={`col-span-2 whitespace-nowrap ${MONO} text-xs md:col-span-1`}>
        <DeltaText r={r} />
      </div>
    </div>
  );
}

function DetailHeader({ checkup }: { checkup: CheckupDetailDto }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/checkups/${checkup.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `삭제하지 못했습니다 (${res.status})`);
      }
      router.push("/medical");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제하지 못했습니다");
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-bright">{checkup.date} 검진</h2>
        <p className="text-[13px] text-sub">
          {[checkup.institution, KIND_LABEL[checkup.kind] ?? checkup.kind, `항목 ${checkup.resultCount}개`].filter(Boolean).join(" · ")}
        </p>
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>
      <div className="flex gap-1.5">
        <Link href={`/medical/${checkup.id}/edit`} className="rounded-lg border border-border bg-surface px-3.5 py-2 text-sm hover:border-border-hover">
          수정
        </Link>
        {confirming ? (
          <>
            <button
              type="button"
              disabled={deleting}
              onClick={remove}
              className="rounded-lg border border-red-500/40 bg-red-900/40 px-3.5 py-2 text-sm text-red-300 disabled:opacity-50"
            >
              {deleting ? "삭제 중…" : "이 회차 삭제"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-lg px-3 py-2 text-sm text-sub hover:text-bright">
              취소
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="rounded-lg px-3 py-2 text-sm text-sub hover:text-bright">
            삭제
          </button>
        )}
      </div>
    </div>
  );
}
