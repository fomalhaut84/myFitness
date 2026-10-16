// #544: 관련 검진 항목 고르기 — 카탈로그 (섹션별) + 검진에 기록된 카탈로그 밖 항목 ("기타 기록 항목"). 순수.
import { CHECKUP_CATEGORIES, CHECKUP_ITEMS } from "@/lib/checkup/items";

export interface ItemOptionGroup {
  category: string;
  items: { code: string; label: string }[];
}

export function itemOptionGroups(custom: readonly { code: string; label: string }[]): ItemOptionGroup[] {
  const catalog = CHECKUP_CATEGORIES.map((category) => ({
    category,
    items: CHECKUP_ITEMS.filter((i) => i.category === category).map((i) => ({ code: i.code, label: i.label })),
  })).filter((g) => g.items.length > 0);
  return custom.length > 0 ? [...catalog, { category: "기록된 다른 항목", items: [...custom] }] : catalog;
}
