// #431: 재싱크 덮어쓰기 가드 — Garmin 보존 창 (~150일) 밖 응답 (시계열 · HRV null) 이 기존 값을 지우지 않는다.
// 회귀: 2026-09-17 backfill:history 가 2025-11 ~ 2026-04-19 의 heartRateValues · avgHR · hrvOvernight 를 null 로 덮어씀.
import { describe, expect, it } from "vitest";
import { WELLNESS_RETENTION_DAYS, hasHeartRateDetail, hasSleepDetail, preserveUpdate, withoutNulls } from "../preserve";

const series = [[1_775_401_200_000, 60], [1_775_401_320_000, 62]];

describe("withoutNulls", () => {
  it("null · undefined 키만 뺀다 — 0 · false · 빈 문자열 · 빈 배열은 남긴다", () => {
    expect(withoutNulls({ a: null, b: undefined, c: 0, d: false, e: "", f: [], g: 5 })).toEqual({ c: 0, d: false, e: "", f: [], g: 5 });
    expect(withoutNulls({})).toEqual({});
  });
});

describe("hasHeartRateDetail / hasSleepDetail", () => {
  it("심박: heartRateValues 가 비지 않은 배열", () => {
    expect(hasHeartRateDetail({ heartRateValues: series })).toBe(true);
    expect(hasHeartRateDetail({ heartRateValues: null })).toBe(false);
    expect(hasHeartRateDetail({ heartRateValues: [] })).toBe(false);
    expect(hasHeartRateDetail({})).toBe(false);
    expect(hasHeartRateDetail(null)).toBe(false);
    expect(hasHeartRateDetail("x")).toBe(false);
  });

  // 회귀: 사전 리뷰 major 1 — sleepLevels 는 보존 창 밖에서도 올 수 있어 상세 판정에 넣지 않는다
  it("수면: avgOvernightHrv 유한수만 — sleepLevels 가 있어도 HRV 없으면 상세 없음", () => {
    expect(hasSleepDetail({ avgOvernightHrv: 43 })).toBe(true);
    expect(hasSleepDetail({ avgOvernightHrv: null, sleepLevels: [{ x: 1 }] })).toBe(false);
    expect(hasSleepDetail({ avgOvernightHrv: Number.NaN })).toBe(false);
    expect(hasSleepDetail(undefined)).toBe(false);
  });

  it("회귀: 기존 rawData 에 HRV 있음 + 응답은 sleepLevels 만 → update 에서 rawData 제외", () => {
    const existingRaw = { avgOvernightHrv: 43, sleepLevels: [{ x: 1 }] };
    const incoming = { hrvOvernight: null, totalSleep: 420, rawData: { avgOvernightHrv: null, sleepLevels: [{ x: 1 }] } };
    const update = preserveUpdate(incoming, { incomingDetail: hasSleepDetail(incoming.rawData), existingDetail: hasSleepDetail(existingRaw) });
    expect(update).toEqual({ totalSleep: 420 });
  });
});

describe("preserveUpdate", () => {
  const incomingTrimmed = { restingHR: 55, avgHR: null, maxHR: null, hrvStatus: null, rawData: { heartRateValues: null, restingHeartRate: 55 } };
  const incomingFull = { restingHR: 55, avgHR: 61, maxHR: 130, hrvStatus: 43, rawData: { heartRateValues: series, restingHeartRate: 55 } };

  // 회귀 1: 기존 배열 + 응답 null → rawData · avgHR · hrvStatus 를 건드리지 않는다 (요약 restingHR 만 갱신)
  it("기존 상세 있음 + 응답 상세 없음 → rawData 와 null 필드 제외", () => {
    expect(preserveUpdate(incomingTrimmed, { incomingDetail: false, existingDetail: true })).toEqual({ restingHR: 55 });
  });

  // 회귀 2: 기존 null + 응답 배열 → 전부 갱신
  it("기존 상세 없음 + 응답 상세 있음 → 전부 포함", () => {
    expect(preserveUpdate(incomingFull, { incomingDetail: true, existingDetail: false })).toEqual(incomingFull);
  });

  // 회귀 3: 둘 다 배열 → 갱신 (새 응답이 정본)
  it("둘 다 상세 있음 → 전부 포함", () => {
    expect(preserveUpdate(incomingFull, { incomingDetail: true, existingDetail: true })).toEqual(incomingFull);
  });

  it("둘 다 상세 없음 → rawData 는 갱신 (요약이라도 최신으로), null 필드만 제외", () => {
    expect(preserveUpdate(incomingTrimmed, { incomingDetail: false, existingDetail: false })).toEqual({ restingHR: 55, rawData: incomingTrimmed.rawData });
  });

  it("입력을 변경하지 않는다", () => {
    const copy = structuredClone(incomingTrimmed);
    preserveUpdate(incomingTrimmed, { incomingDetail: false, existingDetail: true });
    expect(incomingTrimmed).toEqual(copy);
  });
});

describe("WELLNESS_RETENTION_DAYS", () => {
  it("150일 (2026-09-17 기준 경계 2026-04-20 실측)", () => {
    expect(WELLNESS_RETENTION_DAYS).toBe(150);
  });
});
