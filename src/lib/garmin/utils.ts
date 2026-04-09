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

// --- KST 기준 날짜 함수 ---

/** 현재 시간의 KST Date 객체 반환 */
export function nowKST(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}

/** KST 기준 오늘 midnight */
export function todayKST(): Date {
  const kst = nowKST();
  kst.setHours(0, 0, 0, 0);
  return kst;
}

/** KST 기준 어제 midnight */
export function yesterdayKST(): Date {
  const kst = nowKST();
  kst.setDate(kst.getDate() - 1);
  kst.setHours(0, 0, 0, 0);
  return kst;
}

/** KST 기준 N일 전 midnight */
export function daysAgoKST(n: number): Date {
  const kst = nowKST();
  kst.setDate(kst.getDate() - n);
  kst.setHours(0, 0, 0, 0);
  return kst;
}

/** KST 기준 오늘 날짜 문자열 YYYY-MM-DD */
export function todayKSTString(): string {
  return formatDate(todayKST());
}

// --- Legacy (하위 호환) ---

export function yesterday(): Date {
  return yesterdayKST();
}

export function daysAgo(n: number): Date {
  return daysAgoKST(n);
}

/** 데이터 없음 에러인지 판단 */
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
