// #365 (감사 2026-09-17 A1): `@flow-js/garmin-connect` 의 getSleepData(date) · getHeartRate(date) 는 Date 를 `getTimezoneOffset()` 기준
// **서버 로컬 TZ** 로 "YYYY-MM-DD" 문자열화한다. fetcher 는 KST 자정 instant 를 넘기므로 호스트가 UTC 면 하루 전 날짜를 요청해
// 심박 · 수면이 하루 어긋나 저장된다. daily-summary 처럼 KST 문자열 (`formatDate` = `ymdKST`) 을 붙여 `client.get` 을 직접 부른다.
import type { GarminConnect } from "@flow-js/garmin-connect";
import { formatDate } from "./utils";

export const DAILY_SLEEP_URL = "https://connectapi.garmin.com/sleep-service/sleep/dailySleepData";
export const DAILY_HEART_RATE_URL = "https://connectapi.garmin.com/wellness-service/wellness/dailyHeartRate";

export type DailySleepResponse = Awaited<ReturnType<GarminConnect["getSleepData"]>>;
export type DailyHeartRateResponse = Awaited<ReturnType<GarminConnect["getHeartRate"]>>;

/** 순수 — 날짜는 KST 벽시계 (호스트 TZ 무관) */
export function dailySleepUrl(date: Date): string {
  return `${DAILY_SLEEP_URL}?date=${formatDate(date)}`;
}

export function dailyHeartRateUrl(date: Date): string {
  return `${DAILY_HEART_RATE_URL}?date=${formatDate(date)}`;
}

/** 라이브러리 getSleepData 대체. 빈 응답은 그대로 돌려준다 (라이브러리는 throw) — 호출자의 `dailySleepDTO` 가드가 처리 */
export function fetchDailySleep(client: GarminConnect, date: Date): Promise<DailySleepResponse> {
  return client.get<DailySleepResponse>(dailySleepUrl(date));
}

export function fetchDailyHeartRate(client: GarminConnect, date: Date): Promise<DailyHeartRateResponse> {
  return client.get<DailyHeartRateResponse>(dailyHeartRateUrl(date));
}
