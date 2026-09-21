/**
 * #394 (M15-2): 달력 그리드 계산. 순수 · prisma 없음 (client 컴포넌트에서 import 가능).
 * `MonthlyHeatmap` 은 로컬 TZ `new Date(y, m, 1)` 로 달력을 만든다 — 여기서는 ymd 문자열 + 합성 UTC 로만 계산한다 (#365).
 */
import { addDaysYmd, diffDaysYmd } from "./buckets";

const YM_RE = /^(\d{4})-(\d{2})$/;

export function isValidYm(ym: string): boolean {
  const m = YM_RE.exec(ym);
  if (!m) return false;
  const month = Number(m[2]);
  return month >= 1 && month <= 12;
}

export function formatYm(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** `2024-12` + 1 → `2025-01`. 음수 가능. */
export function addMonthsYm(ym: string, months: number): string {
  const [y, m] = ym.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  return formatYm(Math.floor(index / 12), (((index % 12) + 12) % 12) + 1);
}

export function daysInYm(ym: string): number {
  return diffDaysYmd(`${ym}-01`, `${addMonthsYm(ym, 1)}-01`);
}

/** 0 = 일요일 … 6 = 토요일 (그리드 열 순서). */
export function dayOfWeekYmd(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export interface MonthCells {
  ym: string;
  /** 1일 앞의 빈 칸 수 (일요일 시작 그리드) */
  leadingBlanks: number;
  /** 그 달의 모든 날 (ymd, 오름차순) */
  days: string[];
}

export function monthCells(ym: string): MonthCells {
  const first = `${ym}-01`;
  const count = daysInYm(ym);
  return {
    ym,
    leadingBlanks: dayOfWeekYmd(first),
    days: Array.from({ length: count }, (_, i) => addDaysYmd(first, i)),
  };
}
