// #544: 관련 검진 항목 code → 표시 이름 (카탈로그 → 검진 원문 이름 → slug). 순수.
import { getCheckupItem } from "@/lib/checkup/items";

export function itemLabel(code: string, custom: Readonly<Record<string, string>>): string {
  return getCheckupItem(code)?.label ?? custom[code] ?? code.replace(/^custom:/, "");
}
