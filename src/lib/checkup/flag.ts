// #527: 판정 — 기관 판정 우선, 없을 때만 수치 + 기준범위로 계산 (스펙 §3-3). `caution` 은 계산하지 않는다. 순수.

export const CHECKUP_FLAGS = ["normal", "caution", "abnormal"] as const;
export type CheckupFlag = (typeof CHECKUP_FLAGS)[number];
export type FlagSource = "institution" | "computed";

export interface ResolvedFlag {
  flag: CheckupFlag | null;
  flagSource: FlagSource | null;
}

export function resolveFlag(input: {
  flag?: CheckupFlag | null;
  valueNum: number | null;
  refLow: number | null;
  refHigh: number | null;
  lowExclusive?: boolean;
  highExclusive?: boolean;
}): ResolvedFlag {
  if (input.flag) return { flag: input.flag, flagSource: "institution" };
  const { valueNum, refLow, refHigh, lowExclusive = false, highExclusive = false } = input;
  if (valueNum === null || (refLow === null && refHigh === null)) return { flag: null, flagSource: null };
  // 미포함 경계 (`<5.7` 에 5.7) 는 범위 밖 — #527 사전 리뷰 major 2
  const belowLow = refLow !== null && (lowExclusive ? valueNum <= refLow : valueNum < refLow);
  const aboveHigh = refHigh !== null && (highExclusive ? valueNum >= refHigh : valueNum > refHigh);
  const out = belowLow || aboveHigh;
  return { flag: out ? "abnormal" : "normal", flagSource: "computed" };
}
