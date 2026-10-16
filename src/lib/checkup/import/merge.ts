// #532: 쪽별 추출 결과 → 하나로. 겹쳐 찍은 캡처는 같은 행이 두 쪽에 나온다 — 첫 값 유지 · 값이 다르면 충돌 표시. 순수.
import { normalizeLabel } from "../match";
import type { ExtractedItem, ExtractedPage, ExtractedSection } from "./extract-schema";

export interface MergedItem extends ExtractedItem {
  /** 0 부터 — 이 행이 나온 쪽들 */
  pages: number[];
  /** 같은 행이 다른 쪽에서 다른 값으로 읽혔다 */
  conflict: boolean;
  /** 같은 과거 날짜 (pastKey) 값이 쪽마다 다르게 읽힌 회차 키들 (PR #534 Codex P1) */
  pastConflicts: string[];
}

export interface MergedExtraction {
  institution: string | null;
  examDate: string | null;
  /** 쪽마다 다른 검진일이 읽혔다 (첫 값을 쓰고 확인 화면이 알린다) */
  examDateConflict: boolean;
  sections: ExtractedSection[];
  items: MergedItem[];
}

export function valueKey(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "");
}

function itemKey(item: ExtractedItem): string {
  return `${normalizeLabel(item.section ?? "")}|${normalizeLabel(item.label)}`;
}

/** 과거 값의 회차 키 — 날짜를 못 정한 값은 결과지 표기 원문으로 묶는다 */
export function pastKey(p: { date: string | null; dateText: string | null }): string {
  return p.date ?? `?${p.dateText ?? ""}`;
}

/** 첫 값 유지 · 같은 날짜가 다른 값으로 다시 나오면 충돌 키로 남긴다 (조용히 버리지 않는다 · PR #534 Codex P1) */
function mergePast(prev: MergedItem, b: ExtractedItem["past"]): Pick<MergedItem, "past" | "pastConflicts"> {
  const byKey = new Map(prev.past.map((p) => [pastKey(p), p.value]));
  const conflicts = new Set(prev.pastConflicts);
  const added: ExtractedItem["past"] = [];
  for (const p of b) {
    const key = pastKey(p);
    const seen = byKey.get(key);
    if (seen === undefined) {
      byKey.set(key, p.value);
      added.push(p);
    } else if (valueKey(seen) !== valueKey(p.value)) {
      conflicts.add(key);
    }
  }
  return { past: [...prev.past, ...added], pastConflicts: [...conflicts] };
}

function mergeItem(prev: MergedItem, next: ExtractedItem, page: number): MergedItem {
  return {
    ...prev,
    unit: prev.unit ?? next.unit,
    ref: prev.ref ?? next.ref,
    flag: prev.flag ?? next.flag,
    note: prev.note ?? next.note,
    followUp: prev.followUp ?? next.followUp,
    ...mergePast(prev, next.past),
    pages: prev.pages.includes(page) ? prev.pages : [...prev.pages, page],
    conflict: prev.conflict || valueKey(prev.value) !== valueKey(next.value),
  };
}

function mergeSections(pages: readonly ExtractedPage[]): ExtractedSection[] {
  const byCategory = new Map<string, ExtractedSection>();
  for (const section of pages.flatMap((p) => p.sections)) {
    const prev = byCategory.get(section.category);
    const seen = new Set(prev?.findings ?? []);
    const findings = [...(prev?.findings ?? []), ...section.findings.filter((f) => !seen.has(f))];
    byCategory.set(section.category, { category: section.category, findings });
  }
  return [...byCategory.values()].filter((s) => s.findings.length > 0);
}

export function mergePages(pages: readonly ExtractedPage[]): MergedExtraction {
  const items = new Map<string, MergedItem>();
  pages.forEach((page, pageIndex) => {
    for (const item of page.items) {
      const key = itemKey(item);
      const prev = items.get(key);
      items.set(key, prev ? mergeItem(prev, item, pageIndex) : { ...item, pages: [pageIndex], conflict: false, pastConflicts: [] });
    }
  });
  const dates = [...new Set(pages.map((p) => p.examDate).filter((d): d is string => d !== null))];
  return {
    institution: pages.find((p) => p.institution)?.institution ?? null,
    examDate: dates[0] ?? null,
    examDateConflict: dates.length > 1,
    sections: mergeSections(pages),
    items: [...items.values()],
  };
}
