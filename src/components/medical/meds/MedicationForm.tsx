"use client";

// #544: 복약 추가 · 수정 폼. 종류에 따라 복용 형태 기본값 · 단기는 "N일분" 또는 종료일 · 관련 검진 항목 칩.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { defaultRegimen, medFormToInput, resolvedEndDate, type MedFormState } from "@/lib/medication/form-model";
import type { ItemOptionGroup } from "@/lib/medication/item-options";
import { MAX_RELATED_ITEMS, type MedicationKind, type MedicationRegimen } from "@/lib/medication/schema";

interface MedicationFormProps {
  initial: MedFormState;
  medId?: string;
  maxDate: string;
  itemGroups: readonly ItemOptionGroup[];
}

const FIELD = "rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-bright focus:border-accent focus:outline-none";
const INPUT = `w-full ${FIELD}`;
const KINDS: { value: MedicationKind; label: string }[] = [
  { value: "prescription", label: "처방약" },
  { value: "supplement", label: "영양제" },
];
const REGIMENS: { value: MedicationRegimen; label: string }[] = [
  { value: "long_term", label: "장기 복용" },
  { value: "short_term", label: "단기 복용" },
];

export default function MedicationForm({ initial, medId, maxDate, itemGroups }: MedicationFormProps) {
  const router = useRouter();
  const [state, setState] = useState<MedFormState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 복용 형태를 직접 고른 뒤에는 종류를 바꿔도 기본값으로 되돌리지 않는다 (PR 전 리뷰 info 4) */
  const [regimenPicked, setRegimenPicked] = useState(Boolean(medId));
  const set = (patch: Partial<MedFormState>) => setState((s) => ({ ...s, ...patch }));
  const labelOf = (code: string) => itemGroups.flatMap((g) => g.items).find((i) => i.code === code)?.label ?? code.replace(/^custom:/, "");
  const short = state.regimen === "short_term";
  const end = resolvedEndDate(state);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!state.name.trim()) return setError("이름을 입력하세요");
    if (short && !end) return setError(state.endMode === "days" ? "며칠분인지 입력하세요 (1~365)" : "종료일을 입력하세요");
    setSaving(true);
    try {
      const res = await fetch(medId ? `/api/medications/${medId}` : "/api/medications", {
        method: medId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(medFormToInput(state)),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `저장하지 못했습니다 (${res.status})`);
      router.push("/medical?tab=meds");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-3xl rounded-xl border border-border bg-card p-4 md:p-5" aria-label={medId ? "복약 수정" : "복약 추가"}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="종류">
          <Segment
            name="kind"
            options={KINDS}
            value={state.kind}
            onChange={(kind) => set(regimenPicked ? { kind } : { kind, regimen: defaultRegimen(kind) })}
          />
        </Field>
        <Field label="복용 형태" help={medId ? undefined : "처방약은 단기, 영양제는 장기가 기본입니다"}>
          <Segment
            name="regimen"
            options={REGIMENS}
            value={state.regimen}
            onChange={(regimen) => {
              setRegimenPicked(true);
              set({ regimen });
            }}
          />
        </Field>
        <Field label="이름" htmlFor="m-name">
          <input id="m-name" required maxLength={100} value={state.name} onChange={(e) => set({ name: e.target.value })} className={INPUT} />
        </Field>
        <Field label="성분 (선택)" htmlFor="m-ing">
          <input id="m-ing" maxLength={100} placeholder="같은 성분 제품을 묶어 봅니다" value={state.ingredient} onChange={(e) => set({ ingredient: e.target.value })} className={INPUT} />
        </Field>
        <Field label="용량 (선택)" htmlFor="m-dose">
          <input id="m-dose" maxLength={100} placeholder="예: 1정" value={state.dose} onChange={(e) => set({ dose: e.target.value })} className={INPUT} />
        </Field>
        <Field label="횟수 (선택)" htmlFor="m-freq">
          <input id="m-freq" maxLength={100} placeholder="예: 1일 1회 아침 · 필요 시" value={state.frequency} onChange={(e) => set({ frequency: e.target.value })} className={INPUT} />
        </Field>
        <Field label="시작일" htmlFor="m-start">
          <input id="m-start" type="date" required max={maxDate} value={state.startDate} onChange={(e) => set({ startDate: e.target.value })} className={`${INPUT} font-[family-name:var(--font-geist-mono)]`} />
        </Field>
        {short ? (
          <Field label="기간" help="단기 복용은 종료일이 필요합니다">
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              {state.endMode === "days" ? (
                <>
                  <input
                    aria-label="며칠분"
                    inputMode="numeric"
                    value={state.days}
                    onChange={(e) => set({ days: e.target.value.replace(/[^0-9]/g, "") })}
                    className={`${FIELD} w-[70px] font-[family-name:var(--font-geist-mono)]`}
                  />
                  일분 → <span className="font-[family-name:var(--font-geist-mono)] text-bright">{end ?? "—"}</span> 까지
                </>
              ) : (
                <input
                  type="date"
                  aria-label="종료일"
                  min={state.startDate}
                  value={state.endDate}
                  onChange={(e) => set({ endDate: e.target.value })}
                  className={`${FIELD} font-[family-name:var(--font-geist-mono)]`}
                />
              )}
              <button
                type="button"
                onClick={() => set(state.endMode === "days" ? { endMode: "date", endDate: end ?? "" } : { endMode: "days" })}
                className="text-xs text-sub underline hover:text-bright"
              >
                {state.endMode === "days" ? "날짜로 입력" : "며칠분으로 입력"}
              </button>
            </div>
          </Field>
        ) : (
          <Field label="종료일 (선택)" htmlFor="m-end" help="비워 두면 복용 중입니다">
            <input id="m-end" type="date" min={state.startDate} value={state.endDate} onChange={(e) => set({ endDate: e.target.value })} className={`${INPUT} font-[family-name:var(--font-geist-mono)]`} />
          </Field>
        )}
        <Field label="목적 (선택)" htmlFor="m-purpose">
          <input id="m-purpose" maxLength={200} value={state.purpose} onChange={(e) => set({ purpose: e.target.value })} className={INPUT} />
        </Field>
        <Field label="처방처 (선택)" htmlFor="m-pres">
          <input id="m-pres" maxLength={100} value={state.prescriber} onChange={(e) => set({ prescriber: e.target.value })} className={INPUT} />
        </Field>
        <Field
          label="관련 검진 항목 (선택)"
          className="md:col-span-2"
          help="장기 복용 약을 검진 항목과 이으면 항목 추이에 함께 나옵니다. 단기 복용은 지정하지 않아도 검진일 앞 14일 안이면 표시됩니다"
        >
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface p-1.5">
            {state.relatedItems.map((code) => (
              <span key={code} className="flex items-center gap-1 rounded border border-border-hover bg-card px-1.5 text-xs">
                {labelOf(code)}
                <button type="button" aria-label={`${labelOf(code)} 빼기`} onClick={() => set({ relatedItems: state.relatedItems.filter((c) => c !== code) })} className="text-sub hover:text-bright">
                  ×
                </button>
              </span>
            ))}
            <select
              aria-label="관련 검진 항목 추가"
              value=""
              disabled={state.relatedItems.length >= MAX_RELATED_ITEMS}
              onChange={(e) => e.target.value && set({ relatedItems: [...state.relatedItems, e.target.value] })}
              className="min-w-[160px] flex-1 bg-transparent px-1 py-0.5 text-[13px] text-sub focus:outline-none"
            >
              <option value="">항목 추가…</option>
              {itemGroups.map((g) => (
                <optgroup key={g.category} label={g.category}>
                  {g.items
                    .filter((i) => !state.relatedItems.includes(i.code))
                    .map((i) => (
                      <option key={i.code} value={i.code}>
                        {i.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
        </Field>
        <Field label="메모 (선택)" htmlFor="m-note" className="md:col-span-2">
          <textarea id="m-note" rows={2} maxLength={2000} value={state.note} onChange={(e) => set({ note: e.target.value })} className={INPUT} />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        {medId ? <DeleteButton medId={medId} /> : <span />}
        <div className="flex gap-2">
          <Link href="/medical?tab=meds" className="rounded-lg px-3.5 py-2 text-sm text-sub hover:text-bright">
            취소
          </Link>
          <button type="submit" disabled={saving} className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-[#04130a] hover:bg-accent-hover disabled:opacity-50">
            {saving ? "저장 중…" : "저장"}
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

function Field({ label, htmlFor, help, className, children }: { label: string; htmlFor?: string; help?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="mb-1 block text-xs text-sub">
          {label}
        </label>
      ) : (
        <span className="mb-1 block text-xs text-sub">{label}</span>
      )}
      {children}
      {help && <p className="mt-1 text-[11px] text-dim">{help}</p>}
    </div>
  );
}

function Segment<T extends string>({ name, options, value, onChange }: { name: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" className="inline-flex overflow-hidden rounded-lg border border-border">
      {options.map((o) => (
        <label key={o.value} className={`cursor-pointer px-3 py-1.5 text-[13px] ${value === o.value ? "bg-surface-hover text-bright" : "text-sub"}`}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function DeleteButton({ medId }: { medId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/medications/${medId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `삭제하지 못했습니다 (${res.status})`);
      }
      router.push("/medical?tab=meds");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제하지 못했습니다");
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {confirming ? (
        <>
          <button type="button" disabled={deleting} onClick={remove} className="rounded-lg border border-red-500/40 bg-red-900/40 px-3.5 py-2 text-sm text-red-300 disabled:opacity-50">
            {deleting ? "삭제 중…" : "이 복약 기록 삭제"}
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
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
