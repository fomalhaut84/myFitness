// #414: 활동 메타 재조회 창 — 과거 활동을 워치 · Garmin Connect 에서 레이스로 바꾸거나 이름 · 유형을 고쳐도
// 매일 cron 은 3일 창 (`src/lib/cron.ts`) 만 다시 가져와 DB 가 그대로였다 (PR #412 Codex P2). 활동 fetcher 의 upsert `update` 에
// eventType · name · activityType 이 전부 있으므로, 활동 타입만 최근 N일을 되돌아보면 반영된다.
// 비용: 활동 목록은 최신순 20건 페이지 → 30일 ≈ 페이지 2~3개 (API 호출 +1~2 · 각 2초 대기). 순수 모듈 — 싱크 · UI 문구가 공유.

/** 매일 cron · 봇 /sync 가 활동 목록을 되돌아보는 일수. 그보다 오래된 활동은 `backfill:history --types=activities` 로 */
export const ACTIVITY_RECHECK_DAYS = 30;

/**
 * 활동 타입의 startDate 를 `today − days` 까지 앞당긴다 — 창을 **넓히기만** 한다 (백필 청크 · 초기 365일처럼 이미 더 이른
 * startDate 는 그대로). days 가 0 이하 · 비유한이면 무변경. 입력 Date 는 바꾸지 않는다.
 */
export function activityRecheckStart(startDate: Date, today: Date, days: number): Date {
  if (!Number.isFinite(days) || days <= 0) return startDate;
  const lookback = new Date(today);
  lookback.setUTCDate(lookback.getUTCDate() - days);
  return lookback.getTime() < startDate.getTime() ? lookback : startDate;
}
