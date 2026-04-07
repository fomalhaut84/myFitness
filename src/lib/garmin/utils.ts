export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dateRange(startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function yesterday(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 데이터 없음 에러인지 판단. 404/204 또는 "not found"/"empty" 메시지 */
export function isNoDataError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("not found") ||
      msg.includes("empty") ||
      msg.includes("no data") ||
      msg.includes("invalid") ||
      msg.includes("404")
    ) {
      return true;
    }
  }

  const status =
    error !== null &&
    typeof error === "object" &&
    "status" in error
      ? (error as { status: number }).status
      : undefined;

  return status === 404 || status === 204;
}

const API_DELAY_MS = 2000;

export async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  const result = await fn();
  await delay(API_DELAY_MS);
  return result;
}
