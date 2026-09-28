// #425: `Activity.hrr2` · `hrrDrop10` 채움의 순수 부분 — 청크의 활동 → 종료 시각 · 필요한 일자, 시계열 합치기, 곡선 → update payload.
// prisma 호출은 `fill-recovery.ts`.
import { activityEndMs, recoveryDayKeys, type HrSample, type RecoveryCurve } from "./recovery";

export interface FillCandidate {
  id: string;
  startTime: Date;
  duration: number;
  rawData: unknown;
}

export interface FillItem {
  id: string;
  endMs: number;
  /** 종료 앞뒤 창이 걸치는 KST 일자 (1~2일). 첫 원소가 아니라 `ymdKST(endMs)` 가 종료일 */
  dayKeys: string[];
}

export interface FillPlan {
  items: FillItem[];
  /** 청크 전체의 고유 일자 (정렬) — HeartRateRecord 를 한 번에 읽는 키 */
  dayKeys: string[];
}

export function planChunk(rows: readonly FillCandidate[]): FillPlan {
  const items = rows.map((r): FillItem => {
    const endMs = activityEndMs(r.startTime, r.duration, r.rawData);
    return { id: r.id, endMs, dayKeys: recoveryDayKeys(endMs) };
  });
  const dayKeys = [...new Set(items.flatMap((i) => i.dayKeys))].sort();
  return { items, dayKeys };
}

/** 일자 순으로 시계열을 이어 붙인다. 없는 날은 건너뛴다 (`recoveryCurve` 는 정렬을 가정하지 않는다) */
export function mergeSeries(byDay: ReadonlyMap<string, readonly HrSample[]>, keys: readonly string[]): HrSample[] {
  return keys.flatMap((k) => byDay.get(k) ?? []);
}

/** 저장할 값. `hrr2` 가 결측이면 null — 부분 데이터 (저녁 러닝 직후 싱크) · 워치 벗음에 0 을 쓰지 않는다. `hrrDrop10` 은 독립 */
export function recoveryPayload(curve: RecoveryCurve): { hrr2: number; hrrDrop10: number | null } | null {
  if (curve.hrr2 === null) return null;
  return { hrr2: curve.hrr2, hrrDrop10: curve.drop10 };
}
