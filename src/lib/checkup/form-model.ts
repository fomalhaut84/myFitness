// #527 (2/2): 입력 폼 상태 ↔ API 입력 · 상세 응답. 카탈로그 섹션별 행 + 직접 추가 행. 순수.
import { CHECKUP_CATEGORIES, CHECKUP_ITEMS, OTHER_CATEGORY, getCheckupItem } from "./items";
import type { CheckupDetailDto } from "./dto";
import { CHECKUP_FLAGS, type CheckupFlag } from "./flag";
import { CHECKUP_SOURCES, type CheckupInput } from "./schema";

export type FlagChoice = "" | "normal" | "caution" | "abnormal";

export interface FormRow {
  /** React key — 카탈로그 행은 code, 직접 추가 행은 생성 키 */
  key: string;
  itemCode: string | null;
  label: string;
  category: string;
  value: string;
  ref: string;
  flag: FlagChoice;
  unit: string;
  note: string;
  followUp: string;
  followUpDue: string;
  custom: boolean;
}

export interface FormFinding {
  category: string;
  text: string;
  flag: CheckupFlag | null;
}

export interface FormState {
  date: string;
  institution: string;
  kind: "national" | "comprehensive" | "other";
  summary: string;
  rows: FormRow[];
  /**
   * 폼이 편집하지 않는 회차 값 — 수정 저장 (PUT 전체 교체) 이 지우거나 바꾸지 않도록 그대로 돌려보낸다
   * (#527 2/2 사전 리뷰 critical: findings 소실 · source 가 manual 로 바뀜).
   */
  findings: FormFinding[];
  source: CheckupInput["source"];
}

function emptyRow(code: string): FormRow {
  const item = getCheckupItem(code)!;
  return {
    key: code,
    itemCode: code,
    label: item.label,
    category: item.category,
    value: "",
    ref: "",
    flag: "",
    unit: "",
    note: "",
    followUp: "",
    followUpDue: "",
    custom: false,
  };
}

export function newCustomRow(key: string, category: string = OTHER_CATEGORY): FormRow {
  return { ...emptyRow(CHECKUP_ITEMS[0].code), key, itemCode: null, label: "", category, custom: true };
}

export function emptyFormState(today: string): FormState {
  return {
    date: today,
    institution: "",
    kind: "comprehensive",
    summary: "",
    rows: CHECKUP_ITEMS.map((i) => emptyRow(i.code)),
    findings: [],
    source: "manual",
  };
}

/** 상세 응답 → 폼 (카탈로그 행에 값을 채우고, 카탈로그 밖 결과는 직접 추가 행). 결과지 원문 항목명은 보존. */
export function formStateFromDetail(detail: CheckupDetailDto): FormState {
  const byCode = new Map(detail.results.map((r) => [r.itemCode, r]));
  const fill = (row: FormRow, r: CheckupDetailDto["results"][number]): FormRow => ({
    ...row,
    label: r.label,
    value: r.valueText ?? (r.valueNum !== null ? String(r.valueNum) : ""),
    ref: r.refText ?? "",
    // 계산 판정은 저장 시 다시 계산되므로 '자동' 으로 — 기관 판정만 선택값으로 남긴다
    flag: r.flagSource === "institution" ? ((r.flag ?? "") as FlagChoice) : "",
    unit: r.unit && r.unit !== getCheckupItem(r.itemCode)?.unit ? r.unit : "",
    note: r.note ?? "",
    followUp: r.followUp ?? "",
    followUpDue: r.followUpDue ?? "",
  });
  const catalogRows = CHECKUP_ITEMS.map((i) => {
    const r = byCode.get(i.code);
    return r ? fill(emptyRow(i.code), r) : emptyRow(i.code);
  });
  const customRows = detail.results
    .filter((r) => !getCheckupItem(r.itemCode))
    .map((r) => ({ ...fill(newCustomRow(r.itemCode, r.category), r), itemCode: r.itemCode, unit: r.unit ?? "" }));
  return {
    date: detail.date,
    institution: detail.institution ?? "",
    kind: (["national", "comprehensive", "other"] as const).find((k) => k === detail.kind) ?? "other",
    summary: detail.summary ?? "",
    rows: [...catalogRows, ...customRows],
    // 판정 값이 스키마 밖이면 null — 그대로 보내면 PUT 이 400
    findings: detail.findings.map((f) => ({
      category: f.category,
      text: f.text,
      flag: (CHECKUP_FLAGS as readonly string[]).includes(f.flag ?? "") ? (f.flag as CheckupFlag) : null,
    })),
    source: CHECKUP_SOURCES.find((s) => s === detail.source) ?? "manual",
  };
}

export function isRowFilled(row: FormRow): boolean {
  return row.value.trim() !== "";
}

/** 폼 → API 입력. 결과값이 빈 행은 미시행 (보내지 않음). 빈 문자열 선택 칸은 생략. */
export function formStateToInput(state: FormState): CheckupInput {
  const opt = (v: string) => (v.trim() === "" ? undefined : v.trim());
  return {
    date: state.date,
    institution: opt(state.institution) ?? null,
    kind: state.kind,
    source: state.source,
    summary: opt(state.summary) ?? null,
    findings: state.findings.length > 0 ? state.findings : null,
    results: state.rows.filter(isRowFilled).map((row) => ({
      ...(row.itemCode ? { itemCode: row.itemCode } : {}),
      label: row.label.trim(),
      ...(row.custom ? { category: row.category } : {}),
      value: row.value.trim(),
      unit: opt(row.unit) ?? null,
      ref: opt(row.ref) ?? null,
      flag: row.flag === "" ? null : row.flag,
      note: opt(row.note) ?? null,
      followUp: opt(row.followUp) ?? null,
      followUpDue: opt(row.followUpDue) ?? null,
    })),
  };
}

/** 섹션별 묶음 (화면 순서) — 카탈로그 밖 분류는 "기타" 앞 */
export function groupRowsByCategory(rows: readonly FormRow[]): { category: string; rows: FormRow[] }[] {
  const order = [...CHECKUP_CATEGORIES] as string[];
  const extra = [...new Set(rows.map((r) => r.category))].filter((c) => !order.includes(c)).sort((a, b) => a.localeCompare(b, "ko"));
  const cats = [...order.slice(0, -1), ...extra, OTHER_CATEGORY];
  return cats.map((category) => ({ category, rows: rows.filter((r) => r.category === category) })).filter((g) => g.rows.length > 0);
}
