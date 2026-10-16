// #532: 회차 하나의 저장 계획 — 새 회차 생성 / 기존 회차에 없는 항목 추가 · 체크한 항목만 교체 · 나머지 건너뜀. 순수.
import type { ImportRow, PreparedRound } from "./request";

export interface ExistingForPlan {
  id: string;
  hasFindings: boolean;
  itemCodes: ReadonlySet<string>;
}

export interface RoundPlan {
  date: string;
  /** null 이면 새 회차 */
  existingId: string | null;
  add: ImportRow[];
  replace: ImportRow[];
  skipped: number;
  /** 기존 회차 섹션 소견이 비어 있을 때만 채운다 */
  fillFindings: boolean;
}

/** 저장 직전 DB 상태로 판정한다 — 확인 화면 이후 바뀐 것이 있어도 overwrite 없는 기존 항목은 덮지 않는다 */
export function planRound(round: PreparedRound, existing: ExistingForPlan | null): RoundPlan {
  if (!existing) {
    return { date: round.date, existingId: null, add: round.rows, replace: [], skipped: 0, fillFindings: round.findings !== null };
  }
  const add = round.rows.filter((r) => !existing.itemCodes.has(r.itemCode));
  const replace = round.rows.filter((r) => existing.itemCodes.has(r.itemCode) && r.overwrite);
  return {
    date: round.date,
    existingId: existing.id,
    add,
    replace,
    skipped: round.rows.length - add.length - replace.length,
    fillFindings: round.findings !== null && !existing.hasFindings,
  };
}
