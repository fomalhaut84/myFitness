// #527: 검진 조회 응답 형태 (API · 서버 컴포넌트 공용). 날짜는 KST "YYYY-MM-DD". 순수 타입 + 정렬.
import { CHECKUP_ITEMS, categoryOrder } from "./items";
import type { FlagCounts } from "./compare";

export interface CheckupSummaryDto {
  id: string;
  date: string;
  institution: string | null;
  kind: string;
  source: string;
  resultCount: number;
  counts: FlagCounts;
}

export interface PreviousValueDto {
  date: string;
  valueNum: number | null;
  valueText: string | null;
  unit: string | null;
  flag: string | null;
}

export interface CheckupResultDto {
  id: string;
  itemCode: string;
  label: string;
  category: string;
  valueNum: number | null;
  valueText: string | null;
  unit: string | null;
  refText: string | null;
  refLow: number | null;
  refHigh: number | null;
  flag: string | null;
  flagSource: string | null;
  note: string | null;
  followUp: string | null;
  followUpDue: string | null;
  previous: PreviousValueDto | null;
}

export interface CheckupFindingDto {
  category: string;
  text: string;
  flag?: string | null;
}

export interface CheckupDetailDto extends CheckupSummaryDto {
  summary: string | null;
  findings: CheckupFindingDto[];
  results: CheckupResultDto[];
}

export interface TrendPointDto {
  checkupId: string;
  date: string;
  institution: string | null;
  valueNum: number | null;
  valueText: string | null;
  unit: string | null;
  refText: string | null;
  refLow: number | null;
  refHigh: number | null;
  flag: string | null;
}

export interface ItemTrendDto {
  itemCode: string;
  label: string;
  category: string;
  unit: string | null;
  points: TrendPointDto[];
}

export interface FollowUpDto {
  checkupId: string;
  checkupDate: string;
  itemCode: string;
  label: string;
  followUp: string | null;
  followUpDue: string;
}

const CATALOG_INDEX: ReadonlyMap<string, number> = new Map(CHECKUP_ITEMS.map((item, i) => [item.code, i]));

/** 섹션 순서 → 카탈로그 순서 → (카탈로그 밖) 이름순. 새 배열을 돌려준다. */
export function sortResults<T extends { category: string; itemCode: string; label: string }>(results: readonly T[]): T[] {
  return [...results].sort((a, b) => {
    const byCat = categoryOrder(a.category) - categoryOrder(b.category);
    if (byCat !== 0) return byCat;
    if (a.category !== b.category) return a.category.localeCompare(b.category, "ko");
    const ia = CATALOG_INDEX.get(a.itemCode) ?? Number.MAX_SAFE_INTEGER;
    const ib = CATALOG_INDEX.get(b.itemCode) ?? Number.MAX_SAFE_INTEGER;
    return ia !== ib ? ia - ib : a.label.localeCompare(b.label, "ko");
  });
}

/** findings Json → 배열. 형태가 어긋난 원소는 버린다 (DB 는 API 검증을 거친 값만 있지만 외부 데이터로 취급). */
export function toFindings(value: unknown): CheckupFindingDto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((f) =>
    f && typeof f === "object" && typeof f.category === "string" && typeof f.text === "string"
      ? [{ category: f.category, text: f.text, flag: typeof f.flag === "string" ? f.flag : null }]
      : [],
  );
}
