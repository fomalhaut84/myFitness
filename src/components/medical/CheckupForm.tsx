"use client";

// #527 (2/2): 검진 기록 추가 · 수정. 회차 헤더 + 섹션별 접이식 항목 (결과 · 기준범위 원문 · 판정) + 항목 상세 (단위 · 판독문 · 추적검사)
// + 직접 추가. 빈 결과 = 미시행 (보내지 않음). 저장은 POST / PUT — 서버가 매칭 · 해석 · 판정의 정본.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CHECKUP_CATEGORIES, OTHER_CATEGORY, getCheckupItem } from "@/lib/checkup/items";
import { parseReference } from "@/lib/checkup/parse";
import {
  formStateToInput,
  groupRowsByCategory,
  isRowFilled,
  newCustomRow,
  type FlagChoice,
  type FormRow,
  type FormState,
} from "@/lib/checkup/form-model";

interface CheckupFormProps {
  initial: FormState;
  /** 수정이면 회차 id */
  checkupId?: string;
  /** KST 오늘 — 검진일 입력 상한 (서버도 미래 날짜를 거부한다) */
  maxDate: string;
}

const INPUT = "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-bright focus:border-accent focus:outline-none";
const FLAG_OPTIONS: { value: FlagChoice; label: string }[] = [
  { value: "", label: "자동" },
  { value: "normal", label: "정상" },
  { value: "caution", label: "주의" },
  { value: "abnormal", label: "이상" },
];

function referenceHint(ref: string): { text: string; warn: boolean } | null {
  if (!ref.trim()) return null;
  const p = parseReference(ref);
  if (p.refLow !== null && p.refHigh !== null) return { text: `하한 ${p.refLow} · 상한 ${p.refHigh}`, warn: false };
  if (p.refHigh !== null) return { text: `상한 ${p.refHigh}${p.highExclusive ? " (미만)" : ""}`, warn: false };
  if (p.refLow !== null) return { text: `하한 ${p.refLow}${p.lowExclusive ? " (초과)" : ""}`, warn: false };
  if (/음성|양성|정상|^[-+]/.test(ref.trim())) return { text: "정성 기준 (원문 그대로 저장)", warn: false };
  return { text: "숫자 범위로 읽지 못했습니다 — 원문 그대로 저장합니다", warn: true };
}

/** 입력이 있는 섹션만 처음에 펼친다 — 이후 펼침은 사용자 토글 · 직접 추가만 따른다 (값을 지워도 접히지 않게) */
function initiallyOpen(rows: readonly FormRow[]): Set<string> {
  return new Set(groupRowsByCategory(rows).filter((g) => g.rows.some(isRowFilled)).map((g) => g.category));
}

export default function CheckupForm({ initial, checkupId, maxDate }: CheckupFormProps) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState(1);
  // #527 2/2 사전 리뷰 major: `open={filled > 0}` 은 직접 추가 행을 접힌 섹션에 숨기고 마지막 값을 지우면 섹션을 접었다
  const [openCategories, setOpenCategories] = useState<Set<string>>(() => initiallyOpen(initial.rows));
  const setCategoryOpen = (category: string, open: boolean) =>
    setOpenCategories((prev) => {
      if (prev.has(category) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(category);
      else next.delete(category);
      return next;
    });

  const groups = useMemo(() => groupRowsByCategory(state.rows), [state.rows]);
  const filledCount = state.rows.filter(isRowFilled).length;

  const updateRow = (key: string, patch: Partial<FormRow>) => {
    if (patch.category) setCategoryOpen(patch.category, true); // 분류를 바꾼 직접 추가 행이 옮겨 간 섹션도 펼친다
    setState((s) => ({ ...s, rows: s.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  };
  const removeRow = (key: string) => setState((s) => ({ ...s, rows: s.rows.filter((r) => r.key !== key) }));
  const addCustom = () => {
    setState((s) => ({ ...s, rows: [...s.rows, newCustomRow(`new-${nextKey}`)] }));
    setCategoryOpen(OTHER_CATEGORY, true);
    setNextKey((n) => n + 1);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const unnamed = state.rows.find((r) => r.custom && isRowFilled(r) && !r.label.trim());
    if (unnamed) return setError("직접 추가한 항목에 이름을 입력하세요");
    if (filledCount === 0) return setError("결과를 하나 이상 입력하세요");

    setSaving(true);
    try {
      const res = await fetch(checkupId ? `/api/checkups/${checkupId}` : "/api/checkups", {
        method: checkupId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(formStateToInput(state)),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `저장하지 못했습니다 (${res.status})`);
      router.push(`/medical?round=${body.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="bg-card border border-border rounded-xl p-4 md:p-5" aria-labelledby="form-title">
      <h2 id="form-title" className="mb-3.5 text-lg font-semibold text-bright">
        {checkupId ? "검진 기록 수정" : "검진 기록 추가"}
      </h2>

      <div className="grid gap-3 md:grid-cols-3">
        <Field label="검진일" htmlFor="f-date">
          <input id="f-date" type="date" required max={maxDate} value={state.date} onChange={(e) => setState((s) => ({ ...s, date: e.target.value }))} className={INPUT} />
        </Field>
        <Field label="검진기관" htmlFor="f-inst">
          <input
            id="f-inst"
            value={state.institution}
            maxLength={100}
            placeholder="예: ○○병원 건강증진센터"
            onChange={(e) => setState((s) => ({ ...s, institution: e.target.value }))}
            className={INPUT}
          />
        </Field>
        <Field label="종류" htmlFor="f-kind">
          <select id="f-kind" value={state.kind} onChange={(e) => setState((s) => ({ ...s, kind: e.target.value as FormState["kind"] }))} className={INPUT}>
            <option value="comprehensive">종합검진</option>
            <option value="national">국가검진</option>
            <option value="other">기타</option>
          </select>
        </Field>
      </div>
      <Field label="종합 소견 (선택)" htmlFor="f-summary" className="mt-3">
        <textarea
          id="f-summary"
          rows={2}
          maxLength={5000}
          value={state.summary}
          onChange={(e) => setState((s) => ({ ...s, summary: e.target.value }))}
          className={INPUT}
        />
      </Field>

      {groups.map((g) => {
        const filled = g.rows.filter(isRowFilled).length;
        return (
          <details
            key={g.category}
            className="mt-3 rounded-[10px] border border-border"
            open={openCategories.has(g.category)}
            onToggle={(e) => setCategoryOpen(g.category, e.currentTarget.open)}
          >
            <summary className="flex cursor-pointer justify-between px-3.5 py-2.5 text-bright">
              {g.category}
              <small className="text-xs text-dim">
                {g.rows.length}개 항목 · {filled > 0 ? `${filled}개 입력됨` : "입력 없음"}
              </small>
            </summary>
            <div className="hidden grid-cols-[1.2fr_1fr_1.2fr_.9fr_auto] gap-x-2.5 px-3.5 text-[11px] text-dim md:grid">
              <span>항목</span>
              <span>결과</span>
              <span>기준범위 (결과지 그대로)</span>
              <span>판정</span>
              <span className="w-12" />
            </div>
            <div className="px-3.5 pb-3.5">
              {g.rows.map((row) => (
                <RowEditor key={row.key} row={row} onChange={(patch) => updateRow(row.key, patch)} onRemove={() => removeRow(row.key)} />
              ))}
            </div>
          </details>
        );
      })}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={addCustom} className="rounded-lg border border-border bg-surface px-3.5 py-2 text-sm hover:border-border-hover">
          항목 직접 추가
        </button>
        <span className="text-xs text-dim">빈칸은 시행하지 않은 검사로 보고 저장하지 않습니다 · {filledCount}개 입력됨</span>
        <div className="flex gap-2">
          <Link href={checkupId ? `/medical?round=${checkupId}` : "/medical"} className="rounded-lg px-3.5 py-2 text-sm text-sub hover:text-bright">
            취소
          </Link>
          <button type="submit" disabled={saving} className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-[#04130a] hover:bg-accent-hover disabled:opacity-50">
            {saving ? "저장 중…" : "검진 기록 저장"}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}

function Field({ label, htmlFor, className = "", children }: { label: string; htmlFor: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-xs text-sub">
        {label}
      </label>
      {children}
    </div>
  );
}

function RowEditor({ row, onChange, onRemove }: { row: FormRow; onChange: (patch: Partial<FormRow>) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(Boolean(row.note || row.followUp || row.followUpDue || row.unit));
  const hint = referenceHint(row.ref);
  const id = `row-${row.key}`;
  // 저장 시 서버가 카탈로그 단위를 붙인다 — 결과지 단위와 같은지 보이게 (PR #530 Codex P2)
  const catalogUnit = row.itemCode ? (getCheckupItem(row.itemCode)?.unit ?? null) : null;

  return (
    <div className="grid grid-cols-2 items-center gap-x-2.5 gap-y-1.5 border-t border-border py-2 first:border-t-0 md:grid-cols-[1.2fr_1fr_1.2fr_.9fr_auto]">
      <div className="col-span-2 md:col-span-1">
        {row.custom ? (
          <div className="grid grid-cols-2 gap-1.5">
            <input aria-label="항목명" placeholder="항목명" value={row.label} maxLength={100} onChange={(e) => onChange({ label: e.target.value })} className={INPUT} />
            <select aria-label="분류" value={row.category} onChange={(e) => onChange({ category: e.target.value })} className={INPUT}>
              {/* API 로 들어온 카탈로그 밖 분류도 선택값으로 보이게 */}
              {(CHECKUP_CATEGORIES.includes(row.category as (typeof CHECKUP_CATEGORIES)[number])
                ? [...CHECKUP_CATEGORIES]
                : [...CHECKUP_CATEGORIES, row.category]
              ).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        ) : (
          <label htmlFor={`${id}-value`} className="text-[13px] text-muted">
            {row.label}
            {catalogUnit && <small className="ml-1 font-[family-name:var(--font-geist-mono)] text-[11px] text-dim">{catalogUnit}</small>}
          </label>
        )}
      </div>
      <input id={`${id}-value`} aria-label={`${row.label || "항목"} 결과`} value={row.value} maxLength={200} onChange={(e) => onChange({ value: e.target.value })} className={INPUT} />
      <div>
        <input aria-label={`${row.label || "항목"} 기준범위`} value={row.ref} maxLength={100} onChange={(e) => onChange({ ref: e.target.value })} className={INPUT} />
        {hint && <p className={`mt-0.5 font-[family-name:var(--font-geist-mono)] text-[11px] ${hint.warn ? "text-amber-300" : "text-sub"}`}>{hint.text}</p>}
      </div>
      <select aria-label={`${row.label || "항목"} 판정`} value={row.flag} onChange={(e) => onChange({ flag: e.target.value as FlagChoice })} className={INPUT}>
        {FLAG_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <div className="flex justify-end gap-1">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="rounded px-1.5 py-1 text-xs text-sub hover:text-bright">
          상세
        </button>
        {row.custom && (
          <button type="button" onClick={onRemove} className="rounded px-1.5 py-1 text-xs text-sub hover:text-red-400" aria-label="이 항목 빼기">
            빼기
          </button>
        )}
      </div>
      {open && (
        <div className="col-span-2 grid gap-1.5 rounded-lg bg-surface/50 p-2 md:col-span-5 md:grid-cols-[1fr_2fr_1.4fr_1fr]">
          <input aria-label="단위 (결과지 단위가 다를 때)" placeholder={catalogUnit ? `단위 — 기본 ${catalogUnit} (결과지와 다를 때만)` : "단위"} value={row.unit} maxLength={30} onChange={(e) => onChange({ unit: e.target.value })} className={INPUT} />
          <textarea aria-label="판독문 · 설명" placeholder="판독문 · 설명" rows={1} value={row.note} maxLength={5000} onChange={(e) => onChange({ note: e.target.value })} className={INPUT} />
          <input aria-label="추적검사 권고" placeholder="추적검사 권고 (예: 12개월 후)" value={row.followUp} maxLength={500} onChange={(e) => onChange({ followUp: e.target.value })} className={INPUT} />
          <input aria-label="추적검사 예정일" type="date" value={row.followUpDue} onChange={(e) => onChange({ followUpDue: e.target.value })} className={INPUT} />
        </div>
      )}
    </div>
  );
}
