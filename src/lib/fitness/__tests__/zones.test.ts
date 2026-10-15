// 회귀: #510 — LTHR > maxHR 이 저장되면 zone 5 가 min > max 로 뒤집혀 AI 프롬프트 · MCP 에 노출됐다
import { describe, expect, it } from "vitest";
import { getZoneRanges } from "../zones";

describe("getZoneRanges zone 5 상한", () => {
  it("maxHR 이 zone 5 하한 이상이면 그대로 상한", () => {
    const z5 = getZoneRanges(160, 180)[4];
    expect(z5).toMatchObject({ min: 160, max: 180 });
  });

  it("maxHR 이 zone 5 하한보다 낮으면 상한을 비운다 (역전 방지)", () => {
    const z5 = getZoneRanges(175, 170)[4];
    expect(z5).toMatchObject({ min: 175, max: null });
  });
});
