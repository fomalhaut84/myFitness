// #418: 러닝 종료 후 심박 회복 (HRR) — 순수 로직. 하루치 심박 시계열 (`HeartRateRecord.rawData.heartRateValues`, 약 2분 격자)
// 과 활동 종료 시각으로 종료 기준 오프셋별 샘플 · 2분 HRR 을 만든다. 보간 · 리샘플 없음 — 워치의 1분 HRR 을 흉내 내지 않는다
// (PR #422 Codex P2). 서버 조회는 `load-recovery.ts`.
import { ymdKST } from "@/lib/garmin/utils";

/** `[epochMs, bpm]` — Garmin 은 워치를 벗은 구간을 `null` 로 준다 */
export type HrSample = readonly [epochMs: number, bpm: number | null];

/** 종료 기준 분. 음수는 곡선의 맥락 (달리던 심박) — 2분 격자라 2분 배수만 */
export const RECOVERY_OFFSETS_MIN = [-4, -2, 0, 2, 4, 6, 10] as const;
export type RecoveryOffsetMin = (typeof RECOVERY_OFFSETS_MIN)[number];
/** 목표 시각에서 이만큼 안의 가장 가까운 샘플만 채택 — 2분 격자에서 항상 한 샘플이 걸린다 */
export const SAMPLE_TOLERANCE_MS = 60_000;
/** 종료 후 이 창이 다음 날로 넘어가면 로더가 다음 날 레코드도 읽는다 (+10 분 + 허용 오차) */
export const RECOVERY_WINDOW_MS = (10 + 1) * 60_000;
const HRR_OFFSET_MIN = 2;
const DROP_OFFSET_MIN = 10;

export interface RecoveryPoint {
  offsetMin: RecoveryOffsetMin;
  /** null = 결측 (허용 오차 안에 샘플 없음 · 워치 벗음) */
  bpm: number | null;
  sampledAtMs: number | null;
}

export interface RecoveryCurve {
  endMs: number;
  points: RecoveryPoint[];
  /** 종료 − 2분 후. 양수 = 회복. 둘 중 하나라도 결측이면 null */
  hrr2: number | null;
  /** 종료 − 10분 후 */
  drop10: number | null;
  /** 종료 이후 (오프셋 ≥ 0) 유효 점 개수 — UI 의 "샘플 부족" 분기 */
  postSamples: number;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** `rawData.heartRateValues` 검증 파서 — 형태가 맞지 않는 원소는 버린다 (rawData 는 타입이 없어 오타 · 형식 변화가 조용히 지나간다) */
export function parseHeartRateValues(raw: unknown): HrSample[] {
  if (!Array.isArray(raw)) return [];
  const out: HrSample[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length !== 2) continue;
    const [t, v] = item as unknown[];
    if (!isFiniteNumber(t)) continue;
    if (v === null) out.push([t, null]);
    else if (isFiniteNumber(v)) out.push([t, v]);
  }
  return out;
}

/** 목표 시각에 가장 가까운 샘플. 허용 오차 밖 · bpm 이 null 또는 0 이하면 null. 동거리면 이른 샘플. 정렬을 가정하지 않는다 (하루 ~700개) */
export function nearestSample(
  series: readonly HrSample[],
  targetMs: number,
  toleranceMs: number = SAMPLE_TOLERANCE_MS,
): { epochMs: number; bpm: number } | null {
  let best: HrSample | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const s of series) {
    const dist = Math.abs(s[0] - targetMs);
    if (dist > toleranceMs) continue;
    if (dist < bestDist || (dist === bestDist && best !== null && s[0] < best[0])) {
      best = s;
      bestDist = dist;
    }
  }
  if (best === null || best[1] === null || best[1] <= 0) return null;
  return { epochMs: best[0], bpm: best[1] };
}

/** 시계열 + 종료 시각 → 오프셋별 샘플 · 2분 HRR · 10분 낙차. 자정 경계는 호출자가 두 날의 시계열을 합쳐 넘긴다 */
export function recoveryCurve(series: readonly HrSample[], endMs: number): RecoveryCurve {
  const points = RECOVERY_OFFSETS_MIN.map((offsetMin): RecoveryPoint => {
    const hit = nearestSample(series, endMs + offsetMin * 60_000);
    return { offsetMin, bpm: hit?.bpm ?? null, sampledAtMs: hit?.epochMs ?? null };
  });
  const at = (offsetMin: RecoveryOffsetMin) => points.find((p) => p.offsetMin === offsetMin)?.bpm ?? null;
  const end = at(0);
  const diff = (later: number | null) => (end === null || later === null ? null : end - later);
  return {
    endMs,
    points,
    hrr2: diff(at(HRR_OFFSET_MIN)),
    drop10: diff(at(DROP_OFFSET_MIN)),
    postSamples: points.filter((p) => p.offsetMin >= 0 && p.bpm !== null).length,
  };
}

/** 종료 시각 (epoch ms). `rawData.elapsedDuration` (일시정지 포함 벽시계) 이 양수 유한값이면 그것, 아니면 `duration` (타이머) */
export function activityEndMs(startTime: Date, durationSec: number, rawData: unknown): number {
  const elapsed = rawData !== null && typeof rawData === "object" ? (rawData as Record<string, unknown>).elapsedDuration : undefined;
  const sec = isFiniteNumber(elapsed) && elapsed > 0 ? elapsed : durationSec;
  return startTime.getTime() + sec * 1000;
}

/** 읽어야 할 `HeartRateRecord` 의 KST 일자 — 종료일, 그리고 종료 + 창이 다음 날이면 그 날도 */
export function recoveryDayKeys(endMs: number): string[] {
  const first = ymdKST(new Date(endMs));
  const last = ymdKST(new Date(endMs + RECOVERY_WINDOW_MS));
  return first === last ? [first] : [first, last];
}
