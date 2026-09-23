// #425 E: 회복이 빨라졌나 — 연도별 2분 HRR (`Activity.hrr2`) 중앙값. 평균이 아니라 중앙값 — 인터벌 · 레이스처럼
// 고심박에서 멈춘 러닝은 HRR 이 크게 나와 평균을 끌어올린다.
import { median } from "./stats";
import type { InsightRun } from "./types";

/** 이보다 적은 해는 중앙값을 내지 않는다 (다른 패널의 5건 규칙과 동일) */
export const MIN_YEAR_RUNS = 5;

export interface RecoveryPoint {
  id: string;
  ymd: string;
  year: number;
  hrr2: number;
  /** GPS 없는 트레드밀은 null — HRR 은 거리와 무관하므로 거르지 않는다 */
  distanceM: number | null;
  race: boolean;
}

export function recoveryPoints(runs: readonly InsightRun[]): RecoveryPoint[] {
  return runs.flatMap((r) => (r.hrr2 === null ? [] : [{ id: r.id, ymd: r.ymd, year: r.year, hrr2: r.hrr2, distanceM: r.distanceM, race: r.race }]));
}

export interface RecoveryYear {
  year: number;
  n: number;
  /** 5건 미만이면 null. 짝수 개면 .5 가 나올 수 있다 — 표시에서 반올림 */
  medianHrr2: number | null;
}

/** 연도 오름차순. `years` 를 주면 그 해 전부를 열로 (포인트 없는 해는 n=0 · null) — 표의 열이 비지 않게 */
export function recoveryByYear(points: readonly RecoveryPoint[], years?: readonly number[]): RecoveryYear[] {
  const byYear = new Map<number, number[]>();
  for (const p of points) byYear.set(p.year, [...(byYear.get(p.year) ?? []), p.hrr2]);
  const keys = years ? [...years] : [...byYear.keys()];
  return keys
    .sort((a, b) => a - b)
    .map((year) => {
      const values = byYear.get(year) ?? [];
      return { year, n: values.length, medianHrr2: values.length >= MIN_YEAR_RUNS ? median(values) : null };
    });
}

/** 답 한 줄: 첫 유효 해와 마지막 유효 해의 중앙값 차. 유효 해가 둘 미만이면 null */
export function recoveryDelta(years: readonly RecoveryYear[]): { firstYear: number; lastYear: number; from: number; to: number; delta: number } | null {
  const usable = years.filter((y) => y.medianHrr2 !== null);
  if (usable.length < 2) return null;
  const first = usable[0];
  const last = usable[usable.length - 1];
  const from = first.medianHrr2 as number;
  const to = last.medianHrr2 as number;
  return { firstYear: first.year, lastYear: last.year, from, to, delta: to - from };
}

/** 시간 축용 소수 연도 — `2024-07-01` → `2024 + 182/366`. KST ymd 문자열에서만 계산 (`new Date(y, m, d)` 금지 · F20) */
export function yearFraction(ymd: string): number {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const dayOfYear = (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000;
  const daysInYear = (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 86_400_000;
  return y + dayOfYear / daysInYear;
}
