// #570: 강도 기준 (심박 / 파워 / 자동) — 가상 값
import { describe, expect, it } from "vitest";
import { computeIntensityFromRawData, parseIntensityBasisSetting } from "../intensity";

const HR_EASY = { hrTimeInZone_1: 600, hrTimeInZone_2: 2400, hrTimeInZone_3: 300, hrTimeInZone_4: 0, hrTimeInZone_5: 0 };
const POWER_THRESHOLD = { powerTimeInZone_1: 300, powerTimeInZone_2: 600, powerTimeInZone_3: 600, powerTimeInZone_4: 1500, powerTimeInZone_5: 0 };

describe("computeIntensityFromRawData 기준 선택", () => {
  it("hr — 파워가 있어도 심박 분포", () => {
    const r = computeIntensityFromRawData({ rawData: { ...HR_EASY, ...POWER_THRESHOLD }, basis: "hr" });
    expect(r?.basis).toBe("hr");
    expect(r?.intensityLabel).toBe("easy");
  });

  it("기준 생략 = hr (기존 호출 호환)", () => {
    expect(computeIntensityFromRawData({ rawData: { ...HR_EASY, ...POWER_THRESHOLD } })?.basis).toBe("hr");
  });

  it("power — 파워 분포로 분류", () => {
    const r = computeIntensityFromRawData({ rawData: { ...HR_EASY, ...POWER_THRESHOLD }, basis: "power" });
    expect(r?.basis).toBe("power");
    expect(r?.intensityLabel).toBe("threshold");
    expect(r?.zoneDistribution.z4).toBe(1500);
  });

  it("power 인데 파워 데이터 없음 → null (심박으로 대체하지 않음)", () => {
    expect(computeIntensityFromRawData({ rawData: HR_EASY, basis: "power" })).toBeNull();
  });

  it("auto — 파워 있으면 파워, 없으면 심박", () => {
    expect(computeIntensityFromRawData({ rawData: { ...HR_EASY, ...POWER_THRESHOLD }, basis: "auto" })?.basis).toBe("power");
    expect(computeIntensityFromRawData({ rawData: HR_EASY, basis: "auto" })?.basis).toBe("hr");
  });

  it("파워 합계 60초 이하는 데이터 없음으로 본다", () => {
    const tiny = { ...HR_EASY, powerTimeInZone_1: 30, powerTimeInZone_2: 30 };
    expect(computeIntensityFromRawData({ rawData: tiny, basis: "auto" })?.basis).toBe("hr");
  });
});

describe("파워 보정 — 정규화 파워 ≥ 역치 → threshold", () => {
  const easyPower = { powerTimeInZone_1: 600, powerTimeInZone_2: 2400, powerTimeInZone_3: 300, powerTimeInZone_4: 0, powerTimeInZone_5: 0 };

  it("normPower 가 역치 이상이면 easy → threshold", () => {
    const r = computeIntensityFromRawData({ rawData: { ...easyPower, normPower: 305, avgPower: 250 }, basis: "power", thresholdPower: 300 });
    expect(r?.intensityLabel).toBe("threshold");
  });

  it("normPower 없으면 avgPower", () => {
    const r = computeIntensityFromRawData({ rawData: { ...easyPower, avgPower: 310 }, basis: "power", thresholdPower: 300 });
    expect(r?.intensityLabel).toBe("threshold");
  });

  it("역치 미만 · 역치파워 없음 → 보정 없음", () => {
    expect(computeIntensityFromRawData({ rawData: { ...easyPower, normPower: 280 }, basis: "power", thresholdPower: 300 })?.intensityLabel).toBe("easy");
    expect(computeIntensityFromRawData({ rawData: { ...easyPower, normPower: 400 }, basis: "power", thresholdPower: null })?.intensityLabel).toBe("easy");
  });

  it("파워 기준은 심박 보정을 쓰지 않는다", () => {
    const r = computeIntensityFromRawData({ rawData: { ...easyPower, normPower: 200 }, basis: "power", thresholdPower: 300, avgHR: 180, lthr: 160 });
    expect(r?.intensityLabel).toBe("easy");
  });
});

describe("parseIntensityBasisSetting", () => {
  it("모르는 값은 hr", () => {
    expect(parseIntensityBasisSetting("power")).toBe("power");
    expect(parseIntensityBasisSetting("auto")).toBe("auto");
    expect(parseIntensityBasisSetting("x")).toBe("hr");
    expect(parseIntensityBasisSetting(null)).toBe("hr");
  });
});
