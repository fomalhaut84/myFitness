// #440: km 스플릿 파생값 — 순수. Garmin `activity/{id}/splits` 의 lapDTO 를 검증해 km 랩만 남기고, 모델이 표에서 직접 세지 않도록
// 가장 빠른/느린 km · 첫 km 오버페이스 · 전후반 split · 페이스 변동계수 · 심박 드리프트를 미리 계산한다.
import { formatPace } from "@/lib/format";

/** km 랩 판정 범위 — `SplitChart` 와 같은 규칙 (워킹 · 비활성 구간 제외) */
export const KM_LAP_MIN_M = 900;
export const KM_LAP_MAX_M = 1100;
/** 표 상한 — 넘으면 5km 묶음 평균 (울트라) */
export const LAP_TABLE_MAX_ROWS = 60;
const GROUP_KM = 5;

export interface EvalLap {
  distanceM: number;
  durationSec: number;
  /** 초/km — `averageSpeed` 가 0 · 결측이면 null */
  paceSecPerKm: number | null;
  avgHR: number | null;
  maxHR: number | null;
  avgCadence: number | null;
  elevationGainM: number | null;
  avgPower: number | null;
}

export interface LapExtreme {
  /** km 랩 안에서의 1-based 순번 — 표 (`lapTableLines`) 의 `Nkm` 과 같은 번호. 페이스 없는 랩을 걸러도 번호는 유지 (PR #446 Codex P2) */
  index: number;
  paceSecPerKm: number;
}

export interface LapSummary {
  /** 페이스가 있는 km 랩 수 */
  count: number;
  fastest: LapExtreme;
  slowest: LapExtreme;
  meanPaceSecPerKm: number;
  /** 1km 랩 (`kmIndex 1`) 의 페이스 — 그 랩에 페이스가 없으면 null (PR #446 Codex P2: 첫 "페이스 있는" 랩을 첫 km 로 말하지 않는다) */
  firstKmPaceSecPerKm: number | null;
  /** 첫 km 페이스 − 평균 (음수 = 첫 km 가 빠름 = 오버페이스). 1km 랩 페이스 없음 · 랩 2개 미만이면 null */
  firstKmDeltaSec: number | null;
  /** 후반 평균 − 전반 평균 (양수 = positive split). 홀수면 가운데 랩 제외. 랩 2개 미만이면 null */
  halfSplitSec: number | null;
  firstHalfPaceSecPerKm: number | null;
  secondHalfPaceSecPerKm: number | null;
  /** 페이스 표준편차 / 평균 (모집단). 랩 2개 미만이면 null */
  paceCv: number | null;
  /** 후반 평균 심박 − 전반 평균 심박. 어느 쪽이든 심박 있는 랩이 없으면 null */
  hrDriftBpm: number | null;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function num(v: unknown): number | null {
  return isFiniteNumber(v) ? v : null;
}

/** 0 은 결측 (Garmin 은 센서 없는 값을 0 으로 준다) */
function positive(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
}

/** Garmin lapDTO 배열 → 검증된 랩. `distance` · `duration` 이 유한수가 아닌 원소는 버린다 */
export function toEvalLaps(raw: unknown): EvalLap[] {
  if (!Array.isArray(raw)) return [];
  const out: EvalLap[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const lap = item as Record<string, unknown>;
    const distanceM = num(lap.distance);
    const durationSec = num(lap.duration);
    if (distanceM === null || durationSec === null) continue;
    const speed = positive(lap.averageSpeed);
    out.push({
      distanceM,
      durationSec,
      paceSecPerKm: speed !== null ? Math.round(1000 / speed) : null,
      avgHR: positive(lap.averageHR),
      maxHR: positive(lap.maxHR),
      avgCadence: positive(lap.averageRunCadence) !== null ? Math.round(lap.averageRunCadence as number) : null,
      elevationGainM: num(lap.elevationGain),
      avgPower: positive(lap.averagePower),
    });
  }
  return out;
}

export function kmLaps(laps: readonly EvalLap[]): EvalLap[] {
  return laps.filter((l) => l.distanceM >= KM_LAP_MIN_M && l.distanceM <= KM_LAP_MAX_M);
}

/** 페이스가 있는 km 랩 + 표와 같은 1-based 번호 */
type PacedLap = EvalLap & { paceSecPerKm: number; kmIndex: number };

function mean(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function meanOrNull(values: readonly number[]): number | null {
  return values.length > 0 ? mean(values) : null;
}

/** 전반 · 후반 — 홀수면 가운데 랩은 어디에도 넣지 않는다 */
function halves<T>(items: readonly T[]): { first: T[]; second: T[] } {
  const half = Math.floor(items.length / 2);
  return { first: items.slice(0, half), second: items.slice(items.length - half) };
}

function extreme(laps: readonly PacedLap[], pick: "min" | "max"): LapExtreme {
  return laps.reduce<LapExtreme>(
    (best, lap) => {
      const better = pick === "min" ? lap.paceSecPerKm < best.paceSecPerKm : lap.paceSecPerKm > best.paceSecPerKm;
      return better ? { index: lap.kmIndex, paceSecPerKm: lap.paceSecPerKm } : best;
    },
    { index: laps[0].kmIndex, paceSecPerKm: laps[0].paceSecPerKm },
  );
}

/** km 랩에 표 번호를 붙인 뒤 페이스 없는 랩을 거른다 — 번호가 밀리지 않게 */
function pacedKmLaps(laps: readonly EvalLap[]): PacedLap[] {
  return kmLaps(laps).flatMap((l, i) => (l.paceSecPerKm === null ? [] : [{ ...l, paceSecPerKm: l.paceSecPerKm, kmIndex: i + 1 }]));
}

export function summarizeLaps(laps: readonly EvalLap[]): LapSummary | null {
  const paced = pacedKmLaps(laps);
  if (paced.length === 0) return null;
  const paces = paced.map((l) => l.paceSecPerKm);
  const meanPace = mean(paces);
  const single = paced.length < 2;
  const { first, second } = halves(paced);
  const firstPace = single ? null : mean(first.map((l) => l.paceSecPerKm));
  const secondPace = single ? null : mean(second.map((l) => l.paceSecPerKm));
  const firstHr = meanOrNull(first.flatMap((l) => (l.avgHR === null ? [] : [l.avgHR])));
  const secondHr = meanOrNull(second.flatMap((l) => (l.avgHR === null ? [] : [l.avgHR])));
  const variance = mean(paces.map((p) => (p - meanPace) ** 2));
  const firstKm = paced[0].kmIndex === 1 ? paced[0].paceSecPerKm : null;
  return {
    count: paced.length,
    fastest: extreme(paced, "min"),
    slowest: extreme(paced, "max"),
    meanPaceSecPerKm: meanPace,
    firstKmPaceSecPerKm: firstKm,
    firstKmDeltaSec: single || firstKm === null ? null : Math.round(firstKm - meanPace),
    halfSplitSec: firstPace !== null && secondPace !== null ? Math.round(secondPace - firstPace) : null,
    firstHalfPaceSecPerKm: firstPace,
    secondHalfPaceSecPerKm: secondPace,
    paceCv: single ? null : Math.sqrt(variance) / meanPace,
    hrDriftBpm: firstHr !== null && secondHr !== null ? Math.round(secondHr - firstHr) : null,
  };
}

const DASH = "—";

function elevText(m: number | null): string {
  if (m === null) return DASH;
  const r = Math.round(m);
  return `${r < 0 ? "-" : "+"}${Math.abs(r)}m`;
}

function lapLine(label: string, pace: number | null, hr: number | null, cadence: number | null, elev: number | null): string {
  return `${label} ${pace === null ? DASH : formatPace(pace)} · ${hr === null ? DASH : Math.round(hr)}bpm · ${cadence === null ? DASH : Math.round(cadence)} spm · ${elevText(elev)}`;
}

/** km 별 한 줄. 상한을 넘으면 5km 묶음 평균 (묶음 안 결측은 빼고 평균) */
export function lapTableLines(laps: readonly EvalLap[], maxRows: number = LAP_TABLE_MAX_ROWS): string[] {
  const km = kmLaps(laps);
  if (km.length <= maxRows) {
    return km.map((l, i) => lapLine(`${i + 1}km`, l.paceSecPerKm, l.avgHR, l.avgCadence, l.elevationGainM));
  }
  const lines: string[] = [];
  for (let start = 0; start < km.length; start += GROUP_KM) {
    const group = km.slice(start, start + GROUP_KM);
    const from = start + 1;
    const to = start + group.length;
    const label = group.length === 1 ? `${from}km` : `${from}~${to}km`;
    const pick = (f: (l: EvalLap) => number | null) => meanOrNull(group.flatMap((l) => (f(l) === null ? [] : [f(l) as number])));
    const elevSum = group.reduce<number | null>((s, l) => (l.elevationGainM === null ? s : (s ?? 0) + l.elevationGainM), null);
    lines.push(lapLine(label, pick((l) => l.paceSecPerKm), pick((l) => l.avgHR), pick((l) => l.avgCadence), elevSum));
  }
  return lines;
}
