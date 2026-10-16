"use client";

// #532: 확인 화면 — 금회 헤더 · 회차 탭 (새 회차 / 기존 회차 / 날짜 확인 필요) · 행 · 섹션 소견 · 저장 바.
import { useState } from "react";
import { isValidYmd } from "@/lib/history/buckets";
import { KIND_LABEL } from "@/lib/checkup/view";
import { blockingReasons, effectiveRounds, findingsOnly, roundDate, type ImportFinding, type ImportHeader } from "@/lib/checkup/import/assemble";
import { duplicateRows, type DraftRound } from "@/lib/checkup/import/draft";
import { existingDateSet, rowStatus, summarizeImport, type ExistingRound } from "@/lib/checkup/import/status";
import ReviewRows, { type RowPatch } from "./ReviewRows";

interface ImportReviewProps {
  header: ImportHeader;
  rounds: readonly DraftRound[];
  findings: readonly ImportFinding[];
  existing: ReadonlyMap<string, ExistingRound | null>;
  examDateConflict: boolean;
  maxDate: string;
  saving: boolean;
  error: string | null;
  /** 같은 날짜 기존 회차 조회 실패 (#540) */
  lookupError: string | null;
  onRetryLookup: () => void;
  onHeaderChange: (patch: Partial<ImportHeader>) => void;
  onRoundDateChange: (roundKey: string, date: string | null) => void;
  onRowChange: (roundKey: string, rowKey: string, patch: RowPatch) => void;
  onFindingToggle: (key: string) => void;
  onSave: () => void;
}

const INPUT = "w-full rounded-md border bg-surface px-2 py-1.5 text-[13px] text-bright focus:border-accent focus:outline-none";
const PILL = "rounded-full px-[7px] py-px text-[11px] whitespace-nowrap";

export default function ImportReview(props: ImportReviewProps) {
  const { header, rounds, existing } = props;
  const [selected, setSelected] = useState(rounds[0]?.key ?? "current");
  const round = rounds.find((r) => r.key === selected) ?? rounds[0];
  const existingFor = (date: string | null) => (date ? existing.get(date) : null);
  const rowCount = rounds.reduce((n, r) => n + r.rows.length, 0);

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-bright mb-1">읽은 결과 확인</h2>
        <p className="text-dim text-sm">
          {rowCount}개 행 · 회차 {rounds.length}개. 포함할 행을 고르고 매칭이 맞는지 확인하세요. 값은 저장한 뒤 회차 수정에서 고칠 수 있습니다.
        </p>
      </div>

      <HeaderFields {...props} />

      <div role="tablist" aria-label="회차" className="mb-3 flex gap-1.5 overflow-x-auto pb-0.5">
        {rounds.map((r) => (
          <RoundTab key={r.key} round={r} header={header} existing={existingFor(roundDate(r, header.date))} selected={r.key === round.key} onSelect={() => setSelected(r.key)} />
        ))}
      </div>

      <RoundNote round={round} header={header} onRoundDateChange={props.onRoundDateChange} maxDate={props.maxDate} />
      <ReviewRows
        round={round}
        date={roundDate(round, header.date)}
        existing={roundDate(round, header.date) ? existing.get(roundDate(round, header.date) as string) : null}
        duplicates={duplicateRows(round.rows)}
        onChange={(rowKey, patch) => props.onRowChange(round.key, rowKey, patch)}
      />
      {round.current && <Findings findings={props.findings} onToggle={props.onFindingToggle} />}
      <SaveBar {...props} />
    </div>
  );
}

function HeaderFields({ header, examDateConflict, maxDate, onHeaderChange }: ImportReviewProps) {
  const missing = !header.date;
  return (
    <div className="bg-card border border-border rounded-xl mb-4 grid gap-3 p-4 md:grid-cols-3">
      <div>
        <label htmlFor="imp-date" className="mb-1 block text-xs text-sub">
          금회 검진일
        </label>
        <input
          id="imp-date"
          type="date"
          max={maxDate}
          value={header.date}
          onChange={(e) => onHeaderChange({ date: e.target.value })}
          className={`${INPUT} font-[family-name:var(--font-geist-mono)] ${missing ? "border-amber-300" : "border-border"}`}
        />
        {missing && <p className="mt-1 text-[11px] text-amber-300">결과지에서 검진일을 읽지 못했습니다 — 직접 입력하세요</p>}
        {!missing && examDateConflict && <p className="mt-1 text-[11px] text-amber-300">쪽마다 다른 검진일이 읽혔습니다 — 결과지와 대조하세요</p>}
      </div>
      <div>
        <label htmlFor="imp-inst" className="mb-1 block text-xs text-sub">
          기관
        </label>
        <input id="imp-inst" value={header.institution} maxLength={100} onChange={(e) => onHeaderChange({ institution: e.target.value })} className={`${INPUT} border-border`} />
      </div>
      <div>
        <label htmlFor="imp-kind" className="mb-1 block text-xs text-sub">
          종류
        </label>
        <select id="imp-kind" value={header.kind} onChange={(e) => onHeaderChange({ kind: e.target.value as ImportHeader["kind"] })} className={`${INPUT} border-border`}>
          {(["comprehensive", "national", "other"] as const).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function RoundTab({
  round,
  header,
  existing,
  selected,
  onSelect,
}: {
  round: DraftRound;
  header: ImportHeader;
  existing: ExistingRound | null | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const date = roundDate(round, header.date);
  const title = round.current ? (date ? `금회 ${date}` : "금회 (검진일 입력)") : (date ?? `날짜 확인 · ${round.dateText ?? "표기 없음"}`);
  const included = round.rows.filter((r) => r.include).length;
  let badge: { text: string; cls: string };
  let detail = `${included} / ${round.rows.length}개 포함`;
  if (!date) badge = { text: round.current ? "검진일 필요" : "날짜 필요", cls: "bg-amber-900/40 text-amber-300" };
  else if (existing === undefined) badge = { text: "확인 중", cls: "bg-surface text-dim" };
  else if (existing === null) badge = { text: "새 회차", cls: "bg-accent/15 text-accent" };
  else {
    badge = { text: "기존 회차", cls: "bg-surface text-sub" };
    const counts = { new: 0, same: 0, different: 0 };
    for (const r of round.rows) counts[rowStatus(r, existing).status] += 1;
    detail = `추가 ${counts.new} · 다름 ${counts.different} · 같음 ${counts.same}`;
  }
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={`min-w-[150px] shrink-0 rounded-[10px] border px-3 py-2 text-left ${selected ? "border-accent bg-surface" : "border-border bg-card hover:bg-surface"}`}
    >
      <span className="block font-[family-name:var(--font-geist-mono)] text-[13px] font-medium text-bright">{title}</span>
      <span className="mt-1 flex flex-wrap items-center gap-1.5">
        <span className={`${PILL} ${badge.cls}`}>{badge.text}</span>
        <span className="text-[11px] text-sub">{detail}</span>
      </span>
    </button>
  );
}

function RoundNote({
  round,
  header,
  maxDate,
  onRoundDateChange,
}: {
  round: DraftRound;
  header: ImportHeader;
  maxDate: string;
  onRoundDateChange: (key: string, date: string | null) => void;
}) {
  const note = "mb-2.5 text-xs text-sub";
  if (round.current) {
    return <p className={note}>판정 · 기준범위 · 판독문은 결과지 그대로입니다. 파란 테두리는 이름이 정확히 일치하지 않은 매칭, 점선은 목록에 없는 새 항목입니다.</p>;
  }
  const sameAsCurrent = round.date !== null && round.date === header.date;
  return (
    <div className="mb-2.5">
      {round.needsDate && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300/40 bg-amber-900/20 px-3 py-2 text-xs">
          <span className="text-amber-300">
            과거결과 열의 날짜를 읽지 못했습니다{round.dateText ? ` (결과지 표기 "${round.dateText}")` : ""}. 날짜를 넣거나 이 회차의 행을 빼세요.
          </span>
          <input
            type="date"
            aria-label="이 회차의 검진일"
            max={maxDate}
            value={round.date ?? ""}
            onChange={(e) => onRoundDateChange(round.key, e.target.value || null)}
            className="rounded-md border border-border bg-card px-1.5 py-0.5 font-[family-name:var(--font-geist-mono)] text-xs text-bright"
          />
        </div>
      )}
      <p className={note}>
        과거결과 열에는 값만 있어 판정 · 기준범위는 비워 둡니다. 이미 있는 회차면 새 항목만 추가하고, 값이 다른 항목은 덮어쓰기를 체크한 것만 바꿉니다.
        {sameAsCurrent && " 금회와 같은 날짜라 금회에 없는 항목만 금회 회차에 합칩니다."}
      </p>
    </div>
  );
}

function Findings({ findings, onToggle }: { findings: readonly ImportFinding[]; onToggle: (key: string) => void }) {
  if (findings.length === 0) return null;
  return (
    <section aria-labelledby="imp-findings" className="bg-card border border-border rounded-xl mt-4 p-4">
      <h2 id="imp-findings" className="mb-2 text-[13px] font-medium text-bright">
        섹션 소견
      </h2>
      <ul className="space-y-1.5">
        {findings.map((f) => (
          <li key={f.key}>
            <label className={`flex cursor-pointer gap-2 text-[13px] ${f.include ? "text-muted" : "text-dim line-through"}`}>
              <input type="checkbox" checked={f.include} onChange={() => onToggle(f.key)} className="mt-1" />
              <span>
                <span className="mr-1.5 text-xs text-sub">{f.category}</span>
                {f.text}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SaveBar({ header, rounds, findings, existing, saving, error, lookupError, maxDate, onSave, onRetryLookup }: ImportReviewProps) {
  const existingDates = existingDateSet(existing);
  const reasons = blockingReasons({ header, rounds, today: maxDate, findings, existingDates });
  const onlyFindings = findingsOnly({ header, rounds, findings, existingDates });
  // 금회 행을 모두 빼면 summarizeImport 가 금회 날짜를 기다리지 않는다 — 소견만 채우기는 그 조회에 달려 있어 실패 시 다시 확인을 보인다 (PR #546 Codex P2)
  const currentPending = isValidYmd(header.date) && !existing.has(header.date);
  const summary = summarizeImport(effectiveRounds(rounds, header.date), (d) => existing.get(d));
  const disabled = saving || reasons.length > 0 || summary.loading;
  return (
    <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-hover bg-card/95 px-4 py-3 backdrop-blur">
      <div className="text-[13px] text-muted">
        새 회차 <b className="font-[family-name:var(--font-geist-mono)] font-medium text-bright">{summary.newRounds}</b> · 기존 회차{" "}
        <b className="font-[family-name:var(--font-geist-mono)] font-medium text-bright">{summary.existingRounds}</b> · 추가{" "}
        <b className="font-[family-name:var(--font-geist-mono)] font-medium text-bright">{summary.added}</b> · 덮어쓰기{" "}
        <b className="font-[family-name:var(--font-geist-mono)] font-medium text-bright">{summary.overwritten}</b>
        {summary.skipped > 0 && <> · 건너뜀 {summary.skipped}</>}
        {onlyFindings && <p className="mt-0.5 text-xs text-sub">금회 섹션 소견은 기존 회차에 소견이 비어 있을 때만 채웁니다</p>}
        {reasons.length > 0 && <p className="mt-0.5 text-xs text-red-400">{reasons.join(" · ")}</p>}
        {/* 실패한 날짜를 다른 날짜로 바꿔 조회할 것이 없으면 오류도 감춘다 */}
        {lookupError && (summary.loading || currentPending) ? (
          <p role="alert" className="mt-0.5 text-xs text-red-400">
            {lookupError} ·{" "}
            <button type="button" onClick={onRetryLookup} className="underline hover:text-bright">
              다시 확인
            </button>
          </p>
        ) : (
          reasons.length === 0 && summary.loading && <p className="mt-0.5 text-xs text-dim">같은 날짜의 기존 기록을 확인하는 중…</p>
        )}
        {error && (
          <p role="alert" className="mt-0.5 text-xs text-red-400">
            {error}
          </p>
        )}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onSave}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[#04130a] hover:bg-accent-hover disabled:opacity-40"
      >
        {saving ? "저장 중…" : "저장"}
      </button>
    </div>
  );
}
