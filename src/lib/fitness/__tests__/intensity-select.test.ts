// #570: 저장된 두 기준 중 설정 · 상황에 맞는 강도 고르기 — 덮어쓰기 없음 · 가상 값
import { describe, expect, it } from "vitest";
import {
  applyIntensityBasis,
  HEAT_APPARENT_TEMP_C,
  selectIntensity,
  selectIntensityLabel,
  type IntensityContext,
  type StoredIntensity,
} from "../intensity-select";

const kst = (ymd: string) => new Date(`${ymd}T07:00:00+09:00`);
const HR_ONLY: StoredIntensity = {
  startTime: kst("2030-05-10"),
  weatherApparentTempC: 18,
  zoneDistribution: { z1: 1, z2: 2, z3: 3, z4: 4, z5: 5 },
  estimatedZone: 3,
  intensityScore: 60,
  intensityLabel: "tempo",
  powerZoneDistribution: null,
  powerEstimatedZone: null,
  powerIntensityScore: null,
  powerIntensityLabel: null,
};
const BOTH: StoredIntensity = {
  ...HR_ONLY,
  powerZoneDistribution: { z1: 0, z2: 0, z3: 9, z4: 0, z5: 0 },
  powerEstimatedZone: 3,
  powerIntensityScore: 80,
  powerIntensityLabel: "threshold",
};
const ctx = (setting: IntensityContext["setting"], hrAffectedPeriods: IntensityContext["hrAffectedPeriods"] = []): IntensityContext => ({
  setting,
  hrAffectedPeriods,
});

describe("selectIntensity — 심박", () => {
  it("파워가 있어도 심박", () => {
    expect(selectIntensity(BOTH, ctx("hr"))).toMatchObject({ basis: "hr", reason: "setting", intensityLabel: "tempo" });
  });
});

describe("selectIntensity — 파워 (파워 우선 · 없으면 심박)", () => {
  it("파워 있으면 파워", () => {
    expect(selectIntensity(BOTH, ctx("power"))).toMatchObject({ basis: "power", reason: "setting", intensityLabel: "threshold" });
  });

  it("파워 없으면 심박으로 채운다 (러닝 외 · 파워 없는 러닝이 부하에서 빠지지 않게)", () => {
    expect(selectIntensity(HR_ONLY, ctx("power"))).toMatchObject({ basis: "hr", reason: "no_power", intensityScore: 60 });
  });
});

describe("selectIntensity — 자동 (심박을 믿기 어려운 상황에만 파워)", () => {
  it("특이 상황 없으면 심박", () => {
    expect(selectIntensity(BOTH, ctx("auto"))).toMatchObject({ basis: "hr", reason: "normal" });
  });

  it("심박 영향 복약 기간 (시작 · 종료일 포함 · 복용 중) → 파워", () => {
    expect(selectIntensity(BOTH, ctx("auto", [{ start: "2030-05-10", end: null }]))).toMatchObject({ basis: "power", reason: "medication" });
    expect(selectIntensity(BOTH, ctx("auto", [{ start: "2030-05-01", end: "2030-05-10" }])).reason).toBe("medication");
    expect(selectIntensity(BOTH, ctx("auto", [{ start: "2030-05-11", end: null }])).basis).toBe("hr");
    expect(selectIntensity(BOTH, ctx("auto", [{ start: "2030-04-01", end: "2030-05-09" }])).basis).toBe("hr");
  });

  it("체감온도가 기준 이상이면 파워", () => {
    expect(selectIntensity({ ...BOTH, weatherApparentTempC: HEAT_APPARENT_TEMP_C }, ctx("auto"))).toMatchObject({ basis: "power", reason: "heat" });
    expect(selectIntensity({ ...BOTH, weatherApparentTempC: HEAT_APPARENT_TEMP_C - 0.1 }, ctx("auto")).basis).toBe("hr");
    expect(selectIntensity({ ...BOTH, weatherApparentTempC: null }, ctx("auto")).basis).toBe("hr");
  });

  it("상황이어도 파워가 없으면 심박", () => {
    expect(selectIntensity(HR_ONLY, ctx("auto", [{ start: "2030-01-01", end: null }]))).toMatchObject({ basis: "hr", reason: "no_power" });
    expect(selectIntensity(HR_ONLY, ctx("auto"))).toMatchObject({ basis: "hr", reason: "normal" });
  });

  it("심박이 없고 파워만 있으면 파워", () => {
    const powerOnly = { ...BOTH, zoneDistribution: null, estimatedZone: null, intensityScore: null, intensityLabel: null };
    expect(selectIntensity(powerOnly, ctx("auto"))).toMatchObject({ basis: "power", reason: "no_hr" });
  });

  it("복약 기간 판정은 KST 날짜 (UTC 로는 전날인 새벽 러닝)", () => {
    const dawn = { ...BOTH, startTime: new Date("2030-05-10T05:30:00+09:00") };
    expect(selectIntensity(dawn, ctx("auto", [{ start: "2030-05-10", end: null }])).reason).toBe("medication");
  });
});

describe("값이 없을 때", () => {
  it("둘 다 없음 → basis null", () => {
    const none = { ...HR_ONLY, zoneDistribution: null, estimatedZone: null, intensityScore: null, intensityLabel: null };
    for (const s of ["hr", "power", "auto"] as const) expect(selectIntensity(none, ctx(s)).basis).toBeNull();
  });
});

describe("applyIntensityBasis", () => {
  it("심박 필드 자리에 고른 값 · 파워 필드 제거 · 기준 · 이유", () => {
    const out = applyIntensityBasis({ id: "a1", ...BOTH }, ctx("power"));
    expect(out).toMatchObject({ id: "a1", intensityLabel: "threshold", intensityScore: 80, intensityBasis: "power", intensityBasisReason: "setting" });
    expect("powerIntensityLabel" in out).toBe(false);
  });
});

describe("selectIntensityLabel", () => {
  it("selectIntensity 와 같은 규칙", () => {
    const row = { startTime: kst("2030-05-10"), weatherApparentTempC: 30, intensityLabel: "tempo", powerIntensityLabel: "threshold" };
    expect(selectIntensityLabel(row, ctx("hr"))).toEqual({ label: "tempo", basis: "hr" });
    expect(selectIntensityLabel(row, ctx("auto"))).toEqual({ label: "threshold", basis: "power" });
    expect(selectIntensityLabel({ ...row, weatherApparentTempC: 20 }, ctx("auto"))).toEqual({ label: "tempo", basis: "hr" });
    expect(selectIntensityLabel({ ...row, powerIntensityLabel: null }, ctx("power"))).toEqual({ label: "tempo", basis: "hr" });
  });
});

// 회귀: #570 사전 리뷰 major 1 — 파워 존을 심박 존 그대로 합산해 80/20 · 고강도 분이 어긋났다
describe("toComparableZones", () => {
  it("파워 → 심박 등가 (Z1→Z2 · Z2→Z3 · Z3→Z4 · Z4+Z5→Z5) · 심박은 그대로", async () => {
    const { toComparableZones } = await import("../intensity");
    const d = { z1: 10, z2: 20, z3: 30, z4: 40, z5: 5 };
    expect(toComparableZones(d, "power")).toEqual({ z1: 0, z2: 10, z3: 20, z4: 30, z5: 45 });
    expect(toComparableZones(d, "hr")).toBe(d);
    expect(toComparableZones(d, null)).toBe(d);
  });
});
