"use client";

// #532: 회차 하나의 확인 행 — 포함 · 원문 항목명 · 매칭 (카탈로그 select) · 결과 · 기준범위 · 상태 (새 항목 / 같은 값 / 값 다름 → 덮어쓰기).
// 이름이 정확히 일치하지 않은 매칭은 파란 테두리, 카탈로그 밖 (새 항목) 은 점선 — 눈이 갈 곳만 표시 (디자인 노트).
import { CHECKUP_CATEGORIES, CHECKUP_ITEMS, isCustomCode } from "@/lib/checkup/items";
import { newItemCode, type DraftRound, type DraftRow } from "@/lib/checkup/import/draft";
import { rowStatus, type ExistingRound } from "@/lib/checkup/import/status";
import { effectiveFollowUpDue } from "@/lib/checkup/import/assemble";
import { FLAG_LABEL, flagTone } from "@/lib/checkup/view";
import { FLAG_PILL, valueClass } from "../flag-style";

export type RowPatch = Partial<Pick<DraftRow, "include" | "itemCode" | "confidence" | "overwrite" | "followUpDue">>;

interface ReviewRowsProps {
  round: DraftRound;
  /** 이 회차의 검진일 (금회는 헤더 입력값) */
  date: string | null;
  /** undefined: 불러오는 중 · null: 같은 날짜 기존 회차 없음 */
  existing: ExistingRound | null | undefined;
  duplicates: ReadonlyMap<string, string>;
  onChange: (key: string, patch: RowPatch) => void;
}

const NEW_ITEM = "__new__";
const GRID = "md:grid-cols-[36px_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,.8fr)_minmax(0,.9fr)_minmax(0,1.4fr)]";

const CATALOG_GROUPS = CHECKUP_CATEGORIES.map((category) => ({
  category,
  items: CHECKUP_ITEMS.filter((i) => i.category === category),
})).filter((g) => g.items.length > 0);

const PILL = "rounded-full px-[7px] py-px text-[11px] whitespace-nowrap";

export default function ReviewRows({ round, date, existing, duplicates, onChange }: ReviewRowsProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className={`hidden gap-x-2 border-b border-border px-3 py-2.5 text-[11px] text-dim md:grid ${GRID}`}>
        <span className="text-center">포함</span>
        <span>결과지 항목명</span>
        <span>매칭 항목</span>
        <span>결과</span>
        <span>기준범위</span>
        <span>상태</span>
      </div>
      {round.rows.map((row, i) => {
        const newSection = i === 0 || round.rows[i - 1].section !== row.section;
        return (
          <div key={row.key}>
            {newSection && <div className="bg-surface px-3 py-1.5 text-xs text-sub">{row.section ?? "분류 없음"}</div>}
            <Row
              row={row}
              date={date}
              pastColumn={!round.current}
              existing={existing}
              duplicateOf={duplicates.get(row.key) ?? null}
              onChange={(p) => onChange(row.key, p)}
            />
          </div>
        );
      })}
    </div>
  );
}

interface RowProps {
  row: DraftRow;
  date: string | null;
  /** 과거결과 열에서 온 값 (판정 · 기준범위 없음) */
  pastColumn: boolean;
  existing: ExistingRound | null | undefined;
  duplicateOf: string | null;
  onChange: (patch: RowPatch) => void;
}

function Row({ row, date, pastColumn, existing, duplicateOf, onChange }: RowProps) {
  const tone = flagTone(row.flag);
  const matchBorder =
    row.confidence === "fuzzy" ? "border-blue-300/50" : row.confidence === "none" ? "border-dashed border-border-hover" : "border-border";
  return (
    <div
      className={`grid grid-cols-[28px_minmax(0,1fr)_auto] gap-x-2 gap-y-1 border-b border-border px-3 py-2.5 text-[13px] last:border-b-0 md:items-start ${GRID}`}
    >
      <div className="row-span-4 pt-0.5 md:row-span-1 md:text-center">
        <input type="checkbox" checked={row.include} disabled={!row.itemCode} onChange={(e) => onChange({ include: e.target.checked })} aria-label={`${row.label} 포함`} />
      </div>
      <div className={`col-span-2 text-xs text-sub md:col-span-1 md:pt-1 ${row.include ? "" : "opacity-45"}`}>{row.label}</div>
      <div className={row.include ? "" : "opacity-45"}>
        <select
          aria-label={`${row.label} 매칭 항목`}
          value={row.itemCode ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v === NEW_ITEM) onChange({ itemCode: newItemCode(row.label, row.section), confidence: "none" });
            else onChange({ itemCode: v, confidence: "exact" });
          }}
          className={`w-full rounded-md border bg-surface px-1.5 py-1 text-[13px] text-bright focus:border-accent focus:outline-none ${matchBorder}`}
        >
          {!row.itemCode && (
            <option value="" disabled>
              항목을 알아볼 수 없음
            </option>
          )}
          {row.itemCode && isCustomCode(row.itemCode) ? (
            <option value={row.itemCode}>새 항목 — {row.label}</option>
          ) : (
            <option value={NEW_ITEM}>새 항목으로 (목록에 없음)</option>
          )}
          {CATALOG_GROUPS.map((g) => (
            <optgroup key={g.category} label={g.category}>
              {g.items.map((i) => (
                <option key={i.code} value={i.code}>
                  {i.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className={`text-right font-[family-name:var(--font-geist-mono)] md:pt-1 md:text-left ${row.include ? "" : "opacity-45"}`}>
        <span className={valueClass(tone)}>{row.value}</span>
        {row.unit && <span className="ml-1 text-[11px] text-dim">{row.unit}</span>}
      </div>
      <div className={`font-[family-name:var(--font-geist-mono)] text-xs text-sub md:pt-1 ${row.include ? "" : "opacity-45"}`}>{row.ref ?? "—"}</div>
      <div className="col-span-2 md:col-span-1 md:pt-0.5">
        <Status row={row} pastColumn={pastColumn} existing={existing} duplicateOf={duplicateOf} onChange={onChange} />
        {tone && <span className={`${PILL} ${FLAG_PILL[tone]} mr-1 inline-block`}>{FLAG_LABEL[tone]}</span>}
        {row.conflict && <p className="mt-1 text-xs text-amber-300">쪽마다 다르게 읽혔습니다 — 결과지와 대조하세요</p>}
        {row.note && (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-xs text-sub">판독문</summary>
            <p className="mt-1 whitespace-pre-wrap rounded-md bg-surface px-2.5 py-2 text-xs text-muted">{row.note}</p>
          </details>
        )}
        {row.followUp && <FollowUp row={row} date={date} onChange={onChange} />}
      </div>
    </div>
  );
}

function Status({ row, pastColumn, existing, duplicateOf, onChange }: Pick<RowProps, "row" | "pastColumn" | "existing" | "duplicateOf" | "onChange">) {
  if (!row.itemCode) return <p className="text-xs text-red-400">항목을 알아볼 수 없습니다 — 매칭할 항목을 고르세요</p>;
  if (duplicateOf && row.include) {
    return <p className="text-xs text-red-400">&apos;{duplicateOf}&apos; 와 같은 항목으로 매칭됨 — 매칭을 바꾸거나 한쪽을 빼세요</p>;
  }
  if (existing === undefined) return <span className={`${PILL} mr-1 inline-block bg-surface text-dim`}>기존 기록 확인 중</span>;
  const { status, existing: found } = rowStatus(row, existing);
  if (status === "new") return <span className={`${PILL} mr-1 inline-block bg-accent/15 text-accent`}>새 항목</span>;
  if (status === "same") return <span className={`${PILL} mr-1 inline-block bg-surface text-dim`}>같은 값 · 이미 있음</span>;
  return (
    <span className="mr-1 inline-block">
      <span className={`${PILL} ${FLAG_PILL.caution}`}>값 다름</span>
      <span className="ml-1.5 font-[family-name:var(--font-geist-mono)] text-xs text-sub">
        저장된 값 {found?.valueText ?? found?.valueNum ?? ""}
        {found?.unit && row.unit && found.unit !== row.unit ? ` ${found.unit}` : ""}
      </span>
      <label className="mt-1 flex cursor-pointer items-center gap-1.5 text-xs text-amber-300">
        <input type="checkbox" checked={row.overwrite} disabled={!row.include} onChange={(e) => onChange({ overwrite: e.target.checked })} />
        결과지 값으로 덮어쓰기
      </label>
      <span className="mt-0.5 block text-[11px] text-dim">
        {pastColumn
          ? "과거결과 열 값입니다 — 원래 회차 결과지 값이 더 정확할 수 있습니다. 값만 바뀌고 기준범위 · 판정 · 판독문은 유지됩니다"
          : "결과지에 있는 항목만 바뀌고, 결과지에 없는 판독문 · 추적 예정일은 유지됩니다"}
      </span>
    </span>
  );
}

function FollowUp({ row, date, onChange }: Pick<RowProps, "row" | "date" | "onChange">) {
  const due = effectiveFollowUpDue(row, date);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-sub">추적 권고</span>
      <span className="text-muted">{row.followUp}</span>
      <label className="flex items-center gap-1 text-sub">
        예정일
        <input
          type="date"
          value={due ?? ""}
          onChange={(e) => onChange({ followUpDue: e.target.value || null })}
          className="rounded-md border border-border bg-card px-1.5 py-0.5 font-[family-name:var(--font-geist-mono)] text-xs text-bright"
        />
      </label>
      {!due && <span className="text-dim">{date ? "기간을 읽지 못했습니다 — 직접 고르세요" : "검진일을 넣으면 계산합니다"}</span>}
    </div>
  );
}
