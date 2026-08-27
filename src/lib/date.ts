// #321 (M14 Phase 3 #1): KST 기준 주 경계 헬퍼.
// - Mon 00:00 KST 시작 · Sun 24:00 (다음 주 Mon 00:00) 종료.
// - 서버가 UTC 로 실행되어도 KST 월요일 자정 instant 를 정확히 산출.
// - garmin/utils.ts todayKST() 패턴 재사용.

import { ymdKST } from "./garmin/utils";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * #330: /nutrition 히스토리 조회 하한. 이 이전 date 는 서버 파싱 시 오늘 fallback,
 * 클라이언트 nav "이전" 버튼도 disabled. 서버·클라이언트 정합 위해 공유 상수.
 */
export const MIN_HISTORY_YMD = "2020-01-01";

/**
 * URL `?date=YYYY-MM-DD` 파싱. invalid / 미래 / MIN_HISTORY_YMD 이전 → null (caller 가
 * 오늘로 fallback). URL 자체는 수정 안 함. `today` 는 KST 오늘 date string (테스트 주입용).
 */
export function parseHistoryYmd(raw: string | undefined, today: string): string | null {
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const [, y, m, d] = match;
  const dt = new Date(`${raw}T00:00:00+09:00`);
  if (Number.isNaN(dt.getTime())) return null;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  if (formatter.format(dt) !== `${y}-${m}-${d}`) return null; // e.g. 2월 30일
  if (raw > today) return null;
  if (raw < MIN_HISTORY_YMD) return null;
  return raw;
}

/**
 * KST 기준 이번 주 월요일 00:00 KST instant.
 * 일요일이면 6일 전 월요일, 나머지는 (day-1) 일 전 월요일.
 * base 기본은 지금 (KST 오늘). 테스트에서만 base 주입.
 */
export function startOfWeekKST(base?: Date): Date {
  const nowKstMidnight = base
    ? new Date(`${ymdKST(base)}T00:00:00+09:00`)
    : new Date(`${ymdKST()}T00:00:00+09:00`);
  // Intl 로 요일 판정 — Asia/Seoul TZ 에서 요일. Date.getUTCDay() 는 UTC 요일이라
  // KST 자정 instant (UTC 15:00 전날) 의 UTC 요일과 KST 요일이 다를 수 있음 → Intl 사용.
  const weekdayShort = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
  }).format(nowKstMidnight);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dow = map[weekdayShort] ?? 1;
  const diff = dow === 0 ? 6 : dow - 1;
  return new Date(nowKstMidnight.getTime() - diff * DAY_MS);
}

/**
 * KST 기준 이번 주 종료 (exclusive) = 다음 주 월요일 00:00 KST.
 */
export function endOfWeekKST(base?: Date): Date {
  return new Date(startOfWeekKST(base).getTime() + 7 * DAY_MS);
}

/**
 * KST 주 offset (0 = 이번 주 시작, 1 = 지난 주 시작, ...).
 */
export function weekStartKST(offsetWeeks: number, base?: Date): Date {
  return new Date(startOfWeekKST(base).getTime() - offsetWeeks * 7 * DAY_MS);
}
