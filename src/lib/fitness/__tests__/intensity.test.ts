// #570: 강도 계산 — 심박 기준 (기존) · 러닝 파워 기준 (따로 저장 · Stryd 구간 규칙) — 가상 값
import { describe, expect, it } from "vitest";
import {
  classifyIntensity,
  classifyPowerIntensity,
  computeIntensityFromRawData,
  computePowerIntensityFromRawData,
  parseIntensityBasisSetting,
} from "../intensity";

const HR_EASY = { hrTimeInZone_1: 600, hrTimeInZone_2: 2400, hrTimeInZone_3: 300, hrTimeInZone_4: 0, hrTimeInZone_5: 0 };
const POWER_Z3 = { powerTimeInZone_1: 300, powerTimeInZone_2: 600, powerTimeInZone_3: 1500, powerTimeInZone_4: 600, powerTimeInZone_5: 0 };
const z = (z1: number, z2: number, z3: number, z4: number, z5: number) => ({ z1, z2, z3, z4, z5 });
const power = (rawData: Record<string, unknown>, extra: { thresholdPower?: number | null; activityType?: string } = {}) =>
  computePowerIntensityFromRawData({
    rawData,
    activityType: extra.activityType ?? "running",
    thresholdPower: extra.thresholdPower === undefined ? 1000 : extra.thresholdPower,
  });

describe("심박 · 파워 분포는 각자 원본에서", () => {
  it("심박 계산은 파워가 있어도 심박 분포", () => {
    expect(computeIntensityFromRawData({ rawData: { ...HR_EASY, ...POWER_Z3 } })?.intensityLabel).toBe("easy");
  });

  it("파워 계산은 파워 분포", () => {
    const r = power({ ...HR_EASY, ...POWER_Z3 });
    expect(r?.zoneDistribution.z3).toBe(1500);
    expect(r?.intensityLabel).toBe("threshold");
  });

  it("파워 데이터 없음 · 합계 60초 이하 → null", () => {
    expect(power(HR_EASY)).toBeNull();
    expect(power({ powerTimeInZone_1: 30, powerTimeInZone_2: 30 })).toBeNull();
  });
});

// 회귀: PR #571 Codex P2 — 사이클 파워가 러닝 역치파워 기준으로 분류됐다
describe("파워 기준은 러닝 계열에만", () => {
  it("cycling · indoor_cycling → null", () => {
    expect(power(POWER_Z3, { activityType: "cycling" })).toBeNull();
    expect(power(POWER_Z3, { activityType: "indoor_cycling" })).toBeNull();
  });

  it("trail_running · track_running → 계산", () => {
    expect(power(POWER_Z3, { activityType: "trail_running" })).not.toBeNull();
    expect(power(POWER_Z3, { activityType: "track_running" })).not.toBeNull();
  });
});

// 회귀: #570 로컬 실측 — 심박 규칙을 파워 존에 그대로 쓰면 이지런이 recovery, 점수가 절반 가까이로 나왔다
describe("classifyPowerIntensity — 파워 존은 심박 존보다 한 칸 위", () => {
  it("Z1 위주 (역치 65~80%) = easy · 점수는 심박 Z2 이지와 같은 눈금", () => {
    const p = classifyPowerIntensity({ zoneDistribution: z(2000, 0, 0, 0, 0) });
    const hr = classifyIntensity({ zoneDistribution: z(0, 2000, 0, 0, 0) });
    expect(p.intensityLabel).toBe("easy");
    expect(p.intensityScore).toBe(hr.intensityScore);
    expect(p.estimatedZone).toBe(1);
  });

  it("Z2 위주 = tempo · Z3 위주 = threshold · Z4+Z5 = interval · Z5 위주 = max", () => {
    expect(classifyPowerIntensity({ zoneDistribution: z(500, 1500, 0, 0, 0) }).intensityLabel).toBe("tempo");
    expect(classifyPowerIntensity({ zoneDistribution: z(500, 500, 1500, 0, 0) }).intensityLabel).toBe("threshold");
    expect(classifyPowerIntensity({ zoneDistribution: z(500, 500, 0, 800, 200) }).intensityLabel).toBe("interval");
    expect(classifyPowerIntensity({ zoneDistribution: z(500, 0, 0, 0, 800) }).intensityLabel).toBe("max");
  });
});

describe("파워 보정 — 정규화 파워 / 역치", () => {
  const easy = { powerTimeInZone_1: 2400, powerTimeInZone_2: 300, powerTimeInZone_3: 0, powerTimeInZone_4: 0, powerTimeInZone_5: 0 };

  it("NP ≥ 역치 90% → easy 를 threshold 로", () => {
    expect(power({ ...easy, normPower: 270, avgPower: 240 }, { thresholdPower: 300 })?.intensityLabel).toBe("threshold");
  });

  it("NP 없으면 avgPower", () => {
    expect(power({ ...easy, avgPower: 280 }, { thresholdPower: 300 })?.intensityLabel).toBe("threshold");
  });

  it("NP < 역치 65% → recovery", () => {
    expect(power({ ...easy, normPower: 190 }, { thresholdPower: 300 })?.intensityLabel).toBe("recovery");
  });

  it("그 사이 → 보정 없음", () => {
    expect(power({ ...easy, normPower: 230 }, { thresholdPower: 300 })?.intensityLabel).toBe("easy");
  });

  // 회귀: #570 사전 리뷰 major 3 — 역치파워 없이 계산된 값이 싱크로 저장돼 굳었다
  it("역치파워 없음 → 계산하지 않는다 (null)", () => {
    expect(power({ ...easy, normPower: 400 }, { thresholdPower: null })).toBeNull();
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
