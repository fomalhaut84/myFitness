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
//
// 모든 함수는 진짜 KST midnight instant Date를 반환한다 (서버 타임존 무관).
// 구현: Intl.DateTimeFormat("en-CA", timeZone:"Asia/Seoul")로 KST 벽시계 YYYY-MM-DD를
// 추출 → "YYYY-MM-DDT00:00:00+09:00" ISO offset 문자열로 새 Date 생성.
// setUTCDate는 instant 단위 1일 감산 → KST midnight instant 그대로 KST midnight (전날).
// KST는 DST 없음.

/** Date(또는 현재)를 KST 벽시계 기준 YYYY-MM-DD로 변환. 서버 타임존 무관. */
export function ymdKST(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
}

/** 현재 시각 (instant은 절대시각이라 타임존 변환 불필요) */
export function nowKST(): Date {
  return new Date();
}

/** KST 기준 오늘 midnight (정확한 instant) */
export function todayKST(): Date {
  return new Date(`${ymdKST()}T00:00:00+09:00`);
}

/** KST 기준 어제 midnight */
export function yesterdayKST(): Date {
  const t = todayKST();
  t.setUTCDate(t.getUTCDate() - 1);
  return t;
}

/** KST 기준 N일 전 midnight */
export function daysAgoKST(n: number): Date {
  const t = todayKST();
  t.setUTCDate(t.getUTCDate() - n);
  return t;
}

/** KST 기준 오늘 날짜 문자열 YYYY-MM-DD */
export function todayKSTString(): string {
  return ymdKST();
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
