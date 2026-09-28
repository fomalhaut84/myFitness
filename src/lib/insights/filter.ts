// #397 F3: 산점도 공통 필터 — 짧은 워밍업 · 트랙 반복 (3km 미만) 과 GPS 튐 (페이스 범위 밖) 을 뺀다.
// #419: 제외 사유를 분리해 센다 — 거리 · 페이스 없는 러닝 (트레드밀) 이 "페이스 범위 밖" 으로 읽히지 않게.
import type { InsightRun, UsableRun } from "./types";

export const MIN_DISTANCE_M = 3000;
/** 초/km — 2'30" ~ 15'00" */
export const PACE_RANGE: readonly [number, number] = [150, 900];

/** 제외 사유별 건수. 한 건은 한 사유 — 거리 없음 > 3km 미만 > 페이스 범위 밖 */
export interface DroppedBy {
  /** 거리 · 페이스 없음 (GPS 없는 트레드밀 등) */
  noDistance: number;
  /** 3km 미만 */
  tooShort: number;
  /** 페이스 범위 밖 (GPS 튐) */
  paceOut: number;
}

export interface UsableRuns {
  kept: UsableRun[];
  dropped: number;
  droppedBy: DroppedBy;
  total: number;
}

type DropReason = keyof DroppedBy | null;

const dropReason = (r: InsightRun): DropReason => {
  if (r.distanceM === null || r.avgPace === null) return "noDistance";
  if (r.distanceM < MIN_DISTANCE_M) return "tooShort";
  if (r.avgPace < PACE_RANGE[0] || r.avgPace > PACE_RANGE[1]) return "paceOut";
  return null;
};

export function usableRuns(runs: readonly InsightRun[]): UsableRuns {
  // 거리 · 페이스 없는 러닝 (트레드밀 등) 은 여기서만 빠진다 — 존 패널은 전체 러닝을 쓴다
  const kept: UsableRun[] = [];
  const droppedBy: DroppedBy = { noDistance: 0, tooShort: 0, paceOut: 0 };
  for (const r of runs) {
    const reason = dropReason(r);
    if (reason === null) kept.push(r as UsableRun);
    else droppedBy[reason] += 1;
  }
  return { kept, dropped: runs.length - kept.length, droppedBy, total: runs.length };
}

const DROP_LABELS: ReadonlyArray<readonly [keyof DroppedBy, string]> = [
  ["noDistance", "거리 없음"],
  ["tooShort", "3km 미만"],
  ["paceOut", "페이스 범위 밖"],
];

/** 캡션용 — "거리 없음 3건 · 3km 미만 1,200건". 0건 사유는 생략, 전부 0 이면 빈 문자열 */
export function describeDropped(droppedBy: DroppedBy): string {
  return DROP_LABELS.filter(([key]) => droppedBy[key] > 0)
    .map(([key, label]) => `${label} ${droppedBy[key].toLocaleString("ko-KR")}건`)
    .join(" · ");
}
