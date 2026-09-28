// #437: 수면 fetcher payload 조립 (순수). 회귀: 릴리즈 PR #434 Codex P2 — trimmed 응답의 부분 sleepScores 가 sleepScoreDetails 를 덮어씀.
import { describe, expect, it } from "vitest";
import type { SleepDTO, SleepData } from "@flow-js/garmin-connect";
import { buildSleepRecordData, buildSleepScoreDetails, buildSleepUpdatePayload } from "../sleep-payload";

const fullScores = {
  overall: { value: 82, qualifierKey: "GOOD" },
  totalDuration: { qualifierKey: "GOOD" },
  stress: { qualifierKey: "FAIR" },
  awakeCount: { qualifierKey: "EXCELLENT" },
  remPercentage: { value: 22, qualifierKey: "GOOD" },
  deepPercentage: { value: 18, qualifierKey: "FAIR" },
  lightPercentage: { value: 60, qualifierKey: "GOOD" },
  restlessness: { qualifierKey: "GOOD" },
};

function dto(overrides: Record<string, unknown> = {}): SleepDTO {
  return {
    calendarDate: "2026-04-05",
    sleepTimeSeconds: 25_200,
    sleepStartTimestampGMT: 1_775_401_200_000,
    sleepEndTimestampGMT: 1_775_426_400_000,
    deepSleepSeconds: 5_400,
    lightSleepSeconds: 14_400,
    remSleepSeconds: 5_400,
    awakeSleepSeconds: 0,
    averageRespirationValue: 14.5,
    lowestRespirationValue: 11,
    highestRespirationValue: 19,
    avgSleepStress: 12.3,
    averageSpO2Value: 94,
    lowestSpO2Value: 86,
    highestSpO2Value: 98,
    sleepScores: fullScores,
    ...overrides,
  } as unknown as SleepDTO;
}

function sleepData(overrides: Record<string, unknown> = {}): SleepData {
  return {
    dailySleepDTO: dto(),
    sleepLevels: [{ startGMT: "2026-04-05T15:00:00.0", endGMT: "2026-04-05T15:30:00.0", activityLevel: 1 }],
    avgOvernightHrv: 48,
    bodyBatteryChange: 55,
    restingHeartRate: 47,
    ...overrides,
  } as unknown as SleepData;
}

describe("buildSleepScoreDetails", () => {
  it("전체 점수 → 정규화 객체", () => {
    expect(buildSleepScoreDetails(dto())).toEqual({
      overall: 82,
      duration: "GOOD",
      stress: "FAIR",
      awakeCount: "EXCELLENT",
      remPercentage: { value: 22, qualifier: "GOOD" },
      deepPercentage: { value: 18, qualifier: "FAIR" },
      lightPercentage: { value: 60, qualifier: "GOOD" },
      restlessness: "GOOD",
    });
  });

  it("sleepScores 없음 → null · 부분 (overall 만) → 나머지 null", () => {
    expect(buildSleepScoreDetails(dto({ sleepScores: undefined }))).toBeNull();
    const partial = buildSleepScoreDetails(dto({ sleepScores: { overall: { value: 70 } } }));
    expect(partial).toMatchObject({ overall: 70, duration: null, remPercentage: { value: null, qualifier: null } });
  });
});

describe("buildSleepRecordData", () => {
  it("초 → 분 · SpO2 · 호흡 · HRV · rawData 는 응답 그대로", () => {
    const raw = sleepData();
    const data = buildSleepRecordData(raw);
    expect(data).toMatchObject({
      sleepStart: new Date(1_775_401_200_000),
      sleepEnd: new Date(1_775_426_400_000),
      totalSleep: 420,
      deepSleep: 90,
      lightSleep: 240,
      remSleep: 90,
      awakeDuration: null,
      sleepScore: 82,
      avgSpO2: 94,
      lowestSpO2: 86,
      highestSpO2: 98,
      avgRespiration: 14.5,
      avgSleepStress: 12.3,
      bodyBatteryChange: 55,
      restingHR: 47,
      hrvOvernight: 48,
    });
    expect(data.rawData).toBe(raw);
  });

  it("결측 수치는 null (문자열 숫자는 수로)", () => {
    const data = buildSleepRecordData(sleepData({ avgOvernightHrv: undefined, restingHeartRate: "47", bodyBatteryChange: null }));
    expect(data.hrvOvernight).toBeNull();
    expect(data.restingHR).toBe(47);
    expect(data.bodyBatteryChange).toBeNull();
  });
});

describe("buildSleepUpdatePayload", () => {
  const raw = sleepData();
  const data = buildSleepRecordData(raw);
  const details = buildSleepScoreDetails(raw.dailySleepDTO);

  it("trimmed 아님 → rawData · sleepScoreDetails 포함, null 필드 제외", () => {
    const update = buildSleepUpdatePayload(data, details, { trimmed: false });
    expect(update.rawData).toBe(raw);
    expect(update.sleepScoreDetails).toEqual(details);
    expect("awakeDuration" in update).toBe(false);
  });

  // 회귀: 릴리즈 PR #434 Codex P2 (#437) — trimmed 응답의 부분 sleepScores (overall 만) 가 기존 sleepScoreDetails 를 null 섞인 값으로 덮어씀
  it("trimmed → rawData 와 sleepScoreDetails 둘 다 생략 (기존 유지) · 컬럼은 갱신", () => {
    const partial = buildSleepScoreDetails(dto({ sleepScores: { overall: { value: 70 } } }));
    const update = buildSleepUpdatePayload(data, partial, { trimmed: true });
    expect("rawData" in update).toBe(false);
    expect("sleepScoreDetails" in update).toBe(false);
    expect(update.totalSleep).toBe(420);
  });

  it("sleepScores 없음 (null) → 키 자체 없음 · 입력 불변", () => {
    const update = buildSleepUpdatePayload(data, null, { trimmed: false });
    expect("sleepScoreDetails" in update).toBe(false);
    expect(update.rawData).toBe(raw);
    expect(data.rawData).toBe(raw);
    expect(details).toEqual(buildSleepScoreDetails(raw.dailySleepDTO));
  });
});
