// #440: Activity.rawData 에서 승격되지 않은 보조 지표를 뽑는다. rawData 는 타입이 없어 키 오타 · 형식 변화가 조용히 null 이 된다 — 여기서 형태를 검사한다.
import { describe, expect, it } from "vitest";
import { extractRawExtras } from "../raw-extras";

describe("extractRawExtras", () => {
  it("로컬 실측 키를 그대로 읽는다 (문자열 숫자 · 라벨 포함)", () => {
    const extras = extractRawExtras({
      activityTrainingLoad: 58.3,
      trainingEffectLabel: "MAINTAINING",
      aerobicTrainingEffectMessage: "MAINTAINING_AEROBIC_BASE_10",
      avgPower: 251,
      normPower: "258",
      maxPower: 402,
      vO2MaxValue: 49,
      movingDuration: 3060.4,
      elapsedDuration: 3205.4,
      avgVerticalRatio: 8.9,
      avgGroundContactBalance: 49.6,
      fastestSplit_1000: 289.1,
      differenceBodyBattery: -11,
    });
    expect(extras).toEqual({
      trainingLoad: 58.3,
      trainingEffectLabel: "MAINTAINING",
      aerobicTEMessage: "MAINTAINING_AEROBIC_BASE_10",
      avgPower: 251,
      normPower: 258,
      maxPower: 402,
      vo2maxValue: 49,
      movingDurationSec: 3060.4,
      elapsedDurationSec: 3205.4,
      verticalRatioPct: 8.9,
      groundContactBalancePct: 49.6,
      fastestSplit1000Sec: 289.1,
      bodyBatteryDiff: -11,
    });
  });

  it("키가 없거나 형태가 다르면 null — 0 은 값이 아니라 결측 (Garmin 은 없는 지표를 0 으로 준다)", () => {
    const extras = extractRawExtras({ avgPower: 0, normPower: "abc", trainingEffectLabel: 3, differenceBodyBattery: 0 });
    expect(extras.avgPower).toBeNull();
    expect(extras.normPower).toBeNull();
    expect(extras.trainingEffectLabel).toBeNull();
    // 바디배터리 변화는 0 이 정직한 값 (충전 = 소모)
    expect(extras.bodyBatteryDiff).toBe(0);
    expect(extras.trainingLoad).toBeNull();
  });

  it("rawData 가 객체가 아니면 전부 null", () => {
    const extras = extractRawExtras(null);
    expect(Object.values(extras).every((v) => v === null)).toBe(true);
    expect(Object.values(extractRawExtras("x")).every((v) => v === null)).toBe(true);
  });
});
