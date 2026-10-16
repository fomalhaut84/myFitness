// #532: 추적 권고 원문 ("N개월 후 추적검사") → 예정일. 해석 못 하면 null (확인 화면에서 사용자가 입력). 순수.
import { isValidYmd } from "@/lib/history/buckets";

/** 첫 기간 표현만 본다. 범위 (`6~12개월`) 는 앞 (짧은) 쪽 — 늦게 잡아 놓치는 것보다 일찍 알리는 쪽 */
const INTERVAL_RE = /(\d{1,3})\s*(?:[~∼〜\-–]\s*\d{1,3}\s*)?(개월|달|년|주)/;

function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  // 월말 넘침은 그 달 마지막 날로 (1-31 + 1개월 → 2월 말)
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return ymdOf(ny, nm + 1, Math.min(d, lastDay));
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return ymdOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function ymdOf(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function followUpDueFrom(text: string | null, examDate: string | null): string | null {
  if (!text || !examDate || !isValidYmd(examDate)) return null;
  const m = INTERVAL_RE.exec(text.normalize("NFKC"));
  if (!m) return null;
  const n = Number(m[1]);
  if (n <= 0) return null;
  switch (m[2]) {
    case "년":
      return addMonths(examDate, n * 12);
    case "주":
      return addDays(examDate, n * 7);
    default:
      return addMonths(examDate, n);
  }
}
