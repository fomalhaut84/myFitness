import { describe, expect, it } from "vitest";
import { aggregateDaily } from "@/mcp/tools/aggregate";
import { dataSourceLabel, muscleMassLabel, splitMuscleMass } from "../data-source";

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

// 회귀: #514 PR 2 사전 리뷰 major 1 — MCP 주/월 집계에서 Garmin 근육량과 OMRON 골격근량이 한 평균으로 섞였다
describe("splitMuscleMass", () => {
  it("OMRON 행의 muscleMass 는 skeletalMuscleMass 로 옮기고 muscleMass 는 비운다", () => {
    expect(splitMuscleMass({ muscleMass: 27.6, source: "omron" })).toEqual({
      muscleMass: null,
      skeletalMuscleMass: 27.6,
      source: "omron",
    });
  });

  it("Garmin · 직접 입력 행은 그대로 두고 skeletalMuscleMass 는 null", () => {
    expect(splitMuscleMass({ muscleMass: 58.1, source: "garmin" })).toEqual({
      muscleMass: 58.1,
      skeletalMuscleMass: null,
      source: "garmin",
    });
  });

  it("같은 주에 섞여도 집계가 두 값을 평균하지 않는다", () => {
    const week = [
      { date: new Date("2026-10-05T00:00:00+09:00"), muscleMass: 58, source: "garmin" },
      { date: new Date("2026-10-06T00:00:00+09:00"), muscleMass: 28, source: "omron" },
    ].map(splitMuscleMass);
    const [bucket] = aggregateDaily(week, "weekly", { fields: ["muscleMass", "skeletalMuscleMass"] });
    expect(bucket).toMatchObject({ muscleMass: 58, skeletalMuscleMass: 28 });
  });
});
