// #527: 회차 비교 — 항목별 "직전 시행 회차" 값 (결과지 과거결과 열과 같은 규칙 · 바로 전 회차에 없으면 더 앞) · 판정 건수. 순수.
import type { CheckupFlag } from "./flag";

export interface DatedResult {
  /** KST "YYYY-MM-DD" */
  date: string;
  itemCode: string;
}

/**
 * `date` 보다 앞선 회차 중 그 항목이 있는 가장 최근 결과. 입력 순서와 무관.
 * 같은 날짜는 같은 회차 (date unique) 이므로 제외한다.
 */
export function previousResults<T extends DatedResult>(
  date: string,
  itemCodes: readonly string[],
  history: readonly T[],
): Map<string, T> {
  const wanted = new Set(itemCodes);
  const out = new Map<string, T>();
  for (const r of history) {
    if (r.date >= date || !wanted.has(r.itemCode)) continue;
    const cur = out.get(r.itemCode);
    if (!cur || r.date > cur.date) out.set(r.itemCode, r);
  }
  return out;
}

/**
 * 아직 이행되지 않은 추적검사 — 권고한 회차보다 **뒤의 회차에 같은 항목이 있으면** 이행된 것으로 본다
 * (재검을 받았는데 옛 권고가 "N일 지남" 으로 남지 않게). 입력 순서 유지.
 */
export function pendingFollowUps<T extends { checkupDate: string; itemCode: string }>(
  followUps: readonly T[],
  history: readonly DatedResult[],
): T[] {
  const latest = new Map<string, string>();
  for (const r of history) {
    const cur = latest.get(r.itemCode);
    if (!cur || r.date > cur) latest.set(r.itemCode, r.date);
  }
  return followUps.filter((f) => (latest.get(f.itemCode) ?? "") <= f.checkupDate);
}

export interface FlagCounts {
  caution: number;
  abnormal: number;
}

export function countFlags(results: readonly { flag: CheckupFlag | string | null }[]): FlagCounts {
  return results.reduce<FlagCounts>(
    (acc, r) =>
      r.flag === "caution"
        ? { ...acc, caution: acc.caution + 1 }
        : r.flag === "abnormal"
          ? { ...acc, abnormal: acc.abnormal + 1 }
          : acc,
    { caution: 0, abnormal: 0 },
  );
}
