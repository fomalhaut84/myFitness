/**
 * #377: MCP 조회 기간 상한·집계 임계.
 *
 * 이전엔 각 도구 스키마에 `max(365)` 리터럴이 흩어져 있어 DB 에 더 오래된 데이터가 있어도
 * AI 가 볼 수 없었다. 상수 한 곳으로 모아 verify 스크립트가 리터럴 재유입을 잡는다.
 */

/** 조회 일수 상한 (10년). Garmin 원본이 2019-06 부터라 여유 있게 잡는다. */
export const MAX_QUERY_DAYS = 3650;

/** pace-progression / race-prediction 의 최소 window (통계 안정성). */
export const MIN_WINDOW_DAYS = 30;

/** granularity 생략 시 이 일수 이하는 daily. */
export const AUTO_WEEKLY_THRESHOLD_DAYS = 120;

/** granularity 생략 시 이 일수 이하는 weekly, 초과는 monthly. */
export const AUTO_MONTHLY_THRESHOLD_DAYS = 730;

/**
 * daily 응답 행 상한 (사전 리뷰 M2). 명시 granularity=daily 로 days 를 크게 주면 수천 행이 그대로
 * 어드바이저 컨텍스트에 실린다. 초과 시 weekly/monthly 로 자동 승격하고 _context 로 알린다.
 * 잘라내기(take) 는 최신순이라 과거 구간이 조용히 사라져 "가장 좋았던 때" 오답을 유발하므로 쓰지 않는다.
 */
export const MAX_DAILY_ROWS = 400;
