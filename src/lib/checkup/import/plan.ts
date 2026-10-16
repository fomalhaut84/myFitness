// #532: 회차 하나의 저장 계획 — 새 회차 생성 / 기존 회차에 없는 항목 추가 · 체크한 항목만 필드 병합 · 나머지 건너뜀. 순수.
//
// 덮어쓰기 = 행 교체가 아니라 **결과지가 준 필드만 바꾸는 병합** (2026-10-16 사용자 결정).
// 과거결과 열은 값만 있다 — 행을 교체하면 그 회차의 기준범위 · 판정 · 판독문 · 추적 예정일이 지워졌다.
import { parseReference } from "../parse";
import { resolveFlag, type CheckupFlag, type FlagSource } from "../flag";
import type { ImportRow, PreparedRound } from "./request";

/** DB 에 저장된 결과 (병합 · 복구 기록에 필요한 컬럼) */
export interface StoredResult {
  id: string;
  itemCode: string;
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
  followUpDue: Date | null;
}

export interface ExistingForPlan {
  id: string;
  hasFindings: boolean;
  results: ReadonlyMap<string, StoredResult>;
}

export interface ResultUpdate {
  valueNum: number | null;
  valueText: string | null;
  unit: string | null;
  refText: string | null;
  refLow: number | null;
  refHigh: number | null;
  flag: CheckupFlag | null;
  flagSource: FlagSource | null;
  note: string | null;
  followUp: string | null;
  followUpDue: Date | null;
}

/** 덮어쓰기 전 값 — rawData 의 그 가져오기 기록에 남겨 잘못 덮어쓴 것을 되돌릴 수 있게 */
export interface OverwrittenSnapshot {
  itemCode: string;
  valueText: string | null;
  valueNum: number | null;
  unit: string | null;
  refText: string | null;
  flag: string | null;
  flagSource: string | null;
  note: string | null;
  followUp: string | null;
  followUpDue: string | null;
}

export interface ResultReplace {
  id: string;
  itemCode: string;
  data: ResultUpdate;
  previous: OverwrittenSnapshot;
}

export interface RoundPlan {
  date: string;
  /** null 이면 새 회차 */
  existingId: string | null;
  add: ImportRow[];
  replace: ResultReplace[];
  skipped: number;
  /** 기존 회차 섹션 소견이 비어 있을 때만 채운다 */
  fillFindings: boolean;
}

function asFlag(flag: string | null): CheckupFlag | null {
  return flag === "normal" || flag === "caution" || flag === "abnormal" ? flag : null;
}

/**
 * 값은 결과지 것으로. 단위 · 기준범위 · 판독문 · 추적 권고 · 예정일은 결과지가 줬을 때만 바꾸고 아니면 저장된 값 유지.
 * 판정: 결과지 판정 → 그것 / 저장된 기관 판정 → 유지 (실제 측정값에 대한 기관 판단이라 옮겨 적은 값이 틀렸어도 유효) /
 * 그 외 → 새 값 + (병합된) 기준범위로 다시 계산.
 */
export function mergeResultRow(stored: StoredResult, row: ImportRow): ResultUpdate {
  const ref = row.given.ref
    ? { refText: row.refText, refLow: row.refLow, refHigh: row.refHigh }
    : { refText: stored.refText, refLow: stored.refLow, refHigh: stored.refHigh };
  let flag: { flag: CheckupFlag | null; flagSource: FlagSource | null };
  if (row.given.flag) flag = { flag: row.flag, flagSource: row.flagSource };
  else if (stored.flagSource === "institution" && asFlag(stored.flag)) flag = { flag: asFlag(stored.flag), flagSource: "institution" };
  else {
    const { lowExclusive, highExclusive } = parseReference(ref.refText);
    flag = resolveFlag({ flag: null, valueNum: row.valueNum, refLow: ref.refLow, refHigh: ref.refHigh, lowExclusive, highExclusive });
  }
  return {
    valueNum: row.valueNum,
    valueText: row.valueText,
    unit: row.given.unit ? row.unit : stored.unit,
    ...ref,
    ...flag,
    note: row.given.note ? row.note : stored.note,
    followUp: row.given.followUp ? row.followUp : stored.followUp,
    followUpDue: row.given.followUpDue ? row.followUpDue : stored.followUpDue,
  };
}

function snapshot(stored: StoredResult): OverwrittenSnapshot {
  return {
    itemCode: stored.itemCode,
    valueText: stored.valueText,
    valueNum: stored.valueNum,
    unit: stored.unit,
    refText: stored.refText,
    flag: stored.flag,
    flagSource: stored.flagSource,
    note: stored.note,
    followUp: stored.followUp,
    followUpDue: stored.followUpDue ? stored.followUpDue.toISOString() : null,
  };
}

/** 저장 직전 DB 상태로 판정한다 — 확인 화면 이후 바뀐 것이 있어도 overwrite 없는 기존 항목은 덮지 않는다 */
export function planRound(round: PreparedRound, existing: ExistingForPlan | null): RoundPlan {
  if (!existing) {
    return { date: round.date, existingId: null, add: round.rows, replace: [], skipped: 0, fillFindings: round.findings !== null };
  }
  const add = round.rows.filter((r) => !existing.results.has(r.itemCode));
  const replace = round.rows.flatMap((r) => {
    const stored = existing.results.get(r.itemCode);
    return stored && r.overwrite ? [{ id: stored.id, itemCode: r.itemCode, data: mergeResultRow(stored, r), previous: snapshot(stored) }] : [];
  });
  return {
    date: round.date,
    existingId: existing.id,
    add,
    replace,
    skipped: round.rows.length - add.length - replace.length,
    fillFindings: round.findings !== null && !existing.hasFindings,
  };
}
