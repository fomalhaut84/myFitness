// #365 (감사 A1): 라이브러리 getSleepData/getHeartRate 는 Date 를 서버 로컬 TZ 로 문자열화 — KST 자정 instant 를 UTC 호스트에서 넘기면 하루 전을 요청한다.
import { describe, expect, it } from "vitest";
import { DAILY_HEART_RATE_URL, DAILY_SLEEP_URL, dailyHeartRateUrl, dailySleepUrl } from "../daily-endpoints";

const kstMidnight = new Date("2026-04-06T00:00:00+09:00"); // = 2026-04-05T15:00:00Z

describe("daily endpoint URLs", () => {
  it("KST 자정 instant → KST 날짜 (UTC 로 읽으면 전날인 경계)", () => {
    expect(dailySleepUrl(kstMidnight)).toBe(`${DAILY_SLEEP_URL}?date=2026-04-06`);
    expect(dailyHeartRateUrl(kstMidnight)).toBe(`${DAILY_HEART_RATE_URL}?date=2026-04-06`);
  });

  it("라이브러리와 같은 엔드포인트", () => {
    expect(DAILY_SLEEP_URL).toBe("https://connectapi.garmin.com/sleep-service/sleep/dailySleepData");
    expect(DAILY_HEART_RATE_URL).toBe("https://connectapi.garmin.com/wellness-service/wellness/dailyHeartRate");
  });
});
