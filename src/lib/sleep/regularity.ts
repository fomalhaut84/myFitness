// #455 F4: 수면 규칙성 — 순수 (prisma 없음). 취침 · 기상 시각을 KST 소수 시간으로 바꿔 평균 · 표준편차 (모집단) 를 낸다.
// 라벨 임계는 `/lifestyle` `SleepRegularity` 와 한 곳 — 컴포넌트가 `regularityLabel` 을 import 한다.

export type RegularityLabel = "매우 규칙적" | "규칙적" | "보통" | "불규칙";

export interface ClockStat {
  /** "HH:MM" (KST) */
  meanClock: string;
  stdDevHours: number;
}

export interface SleepRegularity {
  n: number;
  bedtime: ClockStat;
  wake: ClockStat;
  /** 취침 표준편차 기준 */
  label: RegularityLabel;
}

const KST = "Asia/Seoul";
/** 18시 이후 취침은 −24 로 접어 자정 기준으로 비교 (23:30 → −0.5) — 22시와 01시가 21시간 차이로 계산되지 않게 */
const FOLD_AFTER_HOUR = 18;
const MIN_ROWS = 2;

const kstParts = new Intl.DateTimeFormat("en-GB", { timeZone: KST, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** KST 시각 → 소수 시간 (0 ≤ h < 24) */
export function clockHoursKST(date: Date): number {
  const parts = kstParts.formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour + minute / 60;
}

/** 취침 시각 — 18시 이후는 −24 (23:30 → −0.5). 기상 시각에는 쓰지 않는다 (`/lifestyle` 과 같은 규칙) */
export function bedtimeHoursKST(date: Date): number {
  const hours = clockHoursKST(date);
  return hours > FOLD_AFTER_HOUR ? hours - 24 : hours;
}

/** 소수 시간 (음수 · 24 이상 포함) → "HH:MM" */
export function formatClockHours(hours: number): string {
  const wrapped = ((hours % 24) + 24) % 24;
  const totalMin = Math.round(wrapped * 60) % (24 * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function regularityLabel(stdDevHours: number): RegularityLabel {
  if (stdDevHours < 0.5) return "매우 규칙적";
  if (stdDevHours < 1.0) return "규칙적";
  if (stdDevHours < 1.5) return "보통";
  return "불규칙";
}

function mean(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function clockStat(hours: readonly number[]): ClockStat {
  const m = mean(hours);
  const variance = mean(hours.map((h) => (h - m) ** 2));
  return { meanClock: formatClockHours(m), stdDevHours: Math.sqrt(variance) };
}

export function sleepRegularity(rows: readonly { sleepStart: Date; sleepEnd: Date }[]): SleepRegularity | null {
  if (rows.length < MIN_ROWS) return null;
  const bedtime = clockStat(rows.map((r) => bedtimeHoursKST(r.sleepStart)));
  const wake = clockStat(rows.map((r) => clockHoursKST(r.sleepEnd)));
  return { n: rows.length, bedtime, wake, label: regularityLabel(bedtime.stdDevHours) };
}
