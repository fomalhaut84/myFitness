// #570: 러닝 파워 존 — 가상 값 (역치 300 W)
import { describe, expect, it } from "vitest";
import {
  calculatePowerZone,
  garminPowerZoneRanges,
  getPowerZoneRanges,
  isValidThresholdPower,
  parseRunningPowerZones,
  resolveProfilePowerZones,
} from "../power-zones";

const RUNNING = {
  sport: "RUNNING",
  functionalThresholdPower: 300,
  zone1Floor: 195,
  zone2Floor: 240,
  zone3Floor: 270,
  zone4Floor: 300,
  zone5Floor: 345,
  zone6Floor: 0,
  zone7Floor: 0,
};

describe("getPowerZoneRanges", () => {
  it("역치 대비 65 · 80 · 90 · 100 · 115% 하한", () => {
    const ranges = getPowerZoneRanges(300);
    expect(ranges.map((r) => r.min)).toEqual([195, 240, 270, 300, 345]);
    expect(ranges[0].max).toBe(239);
    expect(ranges[4].max).toBeNull();
  });
});

describe("parseRunningPowerZones", () => {
  it("종목 배열에서 RUNNING 을 고른다", () => {
    const parsed = parseRunningPowerZones([{ ...RUNNING, sport: "CYCLING", functionalThresholdPower: 200 }, RUNNING]);
    expect(parsed?.functionalThresholdPower).toBe(300);
    expect(garminPowerZoneRanges(parsed!).map((r) => r.min)).toEqual([195, 240, 270, 300, 345]);
  });

  it("저장된 단일 객체도 검증한다", () => {
    expect(parseRunningPowerZones(RUNNING)?.zone5Floor).toBe(345);
  });

  it("RUNNING 없음 · 하한 누락 · 오름차순 아님 → null", () => {
    expect(parseRunningPowerZones([{ ...RUNNING, sport: "ROWING" }])).toBeNull();
    expect(parseRunningPowerZones({ ...RUNNING, zone3Floor: null })).toBeNull();
    expect(parseRunningPowerZones({ ...RUNNING, zone3Floor: 230 })).toBeNull();
    expect(parseRunningPowerZones(null)).toBeNull();
    expect(parseRunningPowerZones("x")).toBeNull();
  });
});

describe("calculatePowerZone", () => {
  it("경계 포함 · 65% 미만은 1", () => {
    expect(calculatePowerZone(100, 300)).toBe(1);
    expect(calculatePowerZone(240, 300)).toBe(2);
    expect(calculatePowerZone(299, 300)).toBe(3);
    expect(calculatePowerZone(300, 300)).toBe(4);
    expect(calculatePowerZone(345, 300)).toBe(5);
  });
});

describe("isValidThresholdPower", () => {
  it("50~1000 정수만", () => {
    expect(isValidThresholdPower(300)).toBe(true);
    expect(isValidThresholdPower(49)).toBe(false);
    expect(isValidThresholdPower(1001)).toBe(false);
    expect(isValidThresholdPower(300.5)).toBe(false);
    expect(isValidThresholdPower("300")).toBe(false);
  });
});

describe("resolveProfilePowerZones", () => {
  it("Garmin 값 + 원본 일치 → Garmin 존", () => {
    const r = resolveProfilePowerZones({ thresholdPower: 300, thresholdPowerSource: "garmin", powerZonesRaw: { ...RUNNING, zone1Floor: 190 } });
    expect(r?.source).toBe("garmin");
    expect(r?.zones[0].min).toBe(190);
  });

  it("수동 값 · 원본 불일치 → 계산", () => {
    expect(resolveProfilePowerZones({ thresholdPower: 300, thresholdPowerSource: "manual", powerZonesRaw: RUNNING })?.source).toBe("calculated");
    expect(resolveProfilePowerZones({ thresholdPower: 310, thresholdPowerSource: "garmin", powerZonesRaw: RUNNING })?.source).toBe("calculated");
  });

  it("역치파워 없음 → null", () => {
    expect(resolveProfilePowerZones({ thresholdPower: null, thresholdPowerSource: null, powerZonesRaw: null })).toBeNull();
  });
});
