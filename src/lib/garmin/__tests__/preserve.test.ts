// #431: 재싱크 덮어쓰기 가드 — Garmin 보존 창 (~150일) 밖 응답 (시계열 · HRV null) 이 기존 값을 지우지 않는다.
// 회귀: 2026-09-17 backfill:history 가 2025-11 ~ 2026-04-19 의 heartRateValues · avgHR · hrvOvernight 를 null 로 덮어씀.
import { describe, expect, it } from "vitest";
import { WELLNESS_RETENTION_DAYS, isTrimmedResponse, preserveUpdate, withoutNulls } from "../preserve";

const series = [[1_775_401_200_000, 60], [1_775_401_320_000, 62]];

describe("withoutNulls", () => {
  it("null · undefined 키만 뺀다 — 0 · false · 빈 문자열 · 빈 배열은 남긴다", () => {
    expect(withoutNulls({ a: null, b: undefined, c: 0, d: false, e: "", f: [], g: 5 })).toEqual({ c: 0, d: false, e: "", f: [], g: 5 });
    expect(withoutNulls({})).toEqual({});
  });
});

describe("preserveUpdate", () => {
  const incomingTrimmed = { restingHR: 55, avgHR: null, maxHR: null, hrvStatus: null, rawData: { heartRateValues: null, restingHeartRate: 55 } };
  const incomingFull = { restingHR: 55, avgHR: 61, maxHR: 130, hrvStatus: 43, rawData: { heartRateValues: series, restingHeartRate: 55 } };

  // 회귀 1: 기존 배열 + 응답 null → rawData · avgHR · hrvStatus 를 건드리지 않는다 (요약 restingHR 만 갱신)
  it("기존 상세 있음 + 응답 상세 없음 → rawData 와 null 필드 제외", () => {
    expect(preserveUpdate(incomingTrimmed, { trimmed: true })).toEqual({ restingHR: 55 });
  });

  // 회귀 2: 기존 null + 응답 배열 → 전부 갱신
  it("기존 상세 없음 + 응답 상세 있음 → 전부 포함", () => {
    expect(preserveUpdate(incomingFull, { trimmed: false })).toEqual(incomingFull);
  });

  // 회귀 3: 둘 다 배열 → 갱신 (새 응답이 정본)
  it("둘 다 상세 있음 → 전부 포함", () => {
    expect(preserveUpdate(incomingFull, { trimmed: false })).toEqual(incomingFull);
  });

  it("둘 다 상세 없음 → rawData 는 갱신 (요약이라도 최신으로), null 필드만 제외", () => {
    expect(preserveUpdate(incomingTrimmed, { trimmed: false })).toEqual({ restingHR: 55, rawData: incomingTrimmed.rawData });
  });

  it("입력을 변경하지 않는다", () => {
    const copy = structuredClone(incomingTrimmed);
    preserveUpdate(incomingTrimmed, { trimmed: true });
    expect(incomingTrimmed).toEqual(copy);
  });
});

describe("WELLNESS_RETENTION_DAYS", () => {
  it("150일 (2026-09-17 기준 경계 2026-04-20 실측)", () => {
    expect(WELLNESS_RETENTION_DAYS).toBe(150);
  });
});

// #435 (릴리즈 PR #434 Codex P2): 상세 판정을 "기존 rawData 에 있던 값이 응답에서 사라졌는가" 로 일반화 —
// HRV 없는 밤의 SpO2 epochs · sleepHeartRate 타임라인도 보존 창 밖 재조회에서 살아남아야 한다.
describe("isTrimmedResponse", () => {
  const spo2 = [{ epochTimestamp: 1, spo2Reading: 95 }];
  const sleepHr = [[1, 60], [2, 58]];

  it("기존에 있던 배열이 응답에서 null · 없음 · 빈 배열이면 trimmed", () => {
    const existing = { avgOvernightHrv: null, wellnessEpochSPO2DataDTOList: spo2, sleepHeartRate: sleepHr, restingHeartRate: 55 };
    expect(isTrimmedResponse({ avgOvernightHrv: null, wellnessEpochSPO2DataDTOList: null, sleepHeartRate: null, restingHeartRate: 55 }, existing)).toBe(true);
    expect(isTrimmedResponse({ restingHeartRate: 55 }, existing)).toBe(true);
    expect(isTrimmedResponse({ wellnessEpochSPO2DataDTOList: [], sleepHeartRate: sleepHr, restingHeartRate: 55 }, existing)).toBe(true);
  });

  it("응답이 기존의 값 있는 키를 전부 갖고 있으면 trimmed 아님 — 새 키 추가 · 값 변경 · 요약 갱신은 갱신", () => {
    const existing = { avgOvernightHrv: 43, sleepLevels: [{ x: 1 }], restingHeartRate: 55 };
    expect(isTrimmedResponse({ avgOvernightHrv: 41, sleepLevels: [{ x: 2 }], restingHeartRate: 54, hrvData: [{ y: 1 }] }, existing)).toBe(false);
    expect(isTrimmedResponse({ avgOvernightHrv: 43, sleepLevels: [{ x: 1 }], restingHeartRate: null }, existing)).toBe(true);
  });

  it("기존이 비어 있거나 (첫 저장 · 요약만) 객체가 아니면 trimmed 아님", () => {
    expect(isTrimmedResponse({ heartRateValues: null }, { heartRateValues: null, restingHeartRate: null })).toBe(false);
    expect(isTrimmedResponse({ heartRateValues: [[1, 60]] }, null)).toBe(false);
    expect(isTrimmedResponse({}, undefined)).toBe(false);
    expect(isTrimmedResponse("x", { a: [1] })).toBe(true);
  });

  it("심박: 기존 heartRateValues 배열 + 응답 null → trimmed (#431 회귀와 동일 결론)", () => {
    expect(isTrimmedResponse({ heartRateValues: null, restingHeartRate: 55 }, { heartRateValues: series, restingHeartRate: 55 })).toBe(true);
    expect(isTrimmedResponse({ heartRateValues: series, restingHeartRate: 55 }, { heartRateValues: null, restingHeartRate: 55 })).toBe(false);
  });

  it("문자열 · 불리언 · 빈 객체 · 0 은 '값 있음' 으로 세지 않는다 (요약 플래그가 바뀌어도 trimmed 아님)", () => {
    const existing = { calendarDate: "2026-04-05", skinTempDataExists: true, sleepScores: {}, restlessMomentsCount: 0 };
    expect(isTrimmedResponse({ calendarDate: null, skinTempDataExists: false, sleepScores: null, restlessMomentsCount: null }, existing)).toBe(false);
  });

  // 사전 리뷰 info 1: 0 아닌 수치 → 0 도 trimmed (rawData 만 유지 · 컬럼은 갱신) — 의도를 고정
  it("0 아닌 수치가 0 으로 바뀌면 trimmed", () => {
    expect(isTrimmedResponse({ restlessMomentsCount: 0 }, { restlessMomentsCount: 5 })).toBe(true);
  });

  it("회귀: 기존 rawData 에 HRV 있음 + 응답은 sleepLevels 만 → update 에서 rawData 제외", () => {
    const existingRaw = { avgOvernightHrv: 43, sleepLevels: [{ x: 1 }] };
    const incoming = { hrvOvernight: null, totalSleep: 420, rawData: { avgOvernightHrv: null, sleepLevels: [{ x: 1 }] } };
    const update = preserveUpdate(incoming, { trimmed: isTrimmedResponse(incoming.rawData, existingRaw) });
    expect(update).toEqual({ totalSleep: 420 });
  });

});

describe("preserveUpdate with trimmed", () => {
  it("trimmed 면 rawData 제외, 아니면 포함 — 기존 시그니처의 incomingDetail/existingDetail 대신 trimmed 하나", () => {
    const data = { hrvOvernight: null, totalSleep: 420, rawData: { a: 1 } };
    expect(preserveUpdate(data, { trimmed: true })).toEqual({ totalSleep: 420 });
    expect(preserveUpdate(data, { trimmed: false })).toEqual({ totalSleep: 420, rawData: { a: 1 } });
  });
});
