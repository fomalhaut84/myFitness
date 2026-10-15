import { describe, expect, it } from "vitest";
import { dataSourceLabel, muscleMassLabel } from "../data-source";

describe("dataSourceLabel", () => {
  it.each([
    ["garmin", "Garmin"],
    ["omron", "OMRON"],
    ["manual", "직접 입력"],
  ])("%s → %s", (source, label) => {
    expect(dataSourceLabel(source)).toBe(label);
  });

  it("알 수 없는 값은 그대로 · 없으면 null", () => {
    expect(dataSourceLabel("other")).toBe("other");
    expect(dataSourceLabel(null)).toBeNull();
    expect(dataSourceLabel(undefined)).toBeNull();
  });
});

describe("muscleMassLabel — #514: OMRON muscleMass 는 골격근량", () => {
  it("OMRON 은 골격근량 · 그 외는 근육량", () => {
    expect(muscleMassLabel("omron")).toBe("골격근량");
    expect(muscleMassLabel("garmin")).toBe("근육량");
    expect(muscleMassLabel("manual")).toBe("근육량");
  });
});
