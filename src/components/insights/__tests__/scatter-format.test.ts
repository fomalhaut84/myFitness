// #397: 산점도 축 포맷터.
import { describe, expect, it } from "vitest";
import { formatAxis } from "../scatter-format";

describe("formatAxis", () => {
  it("종류별 표기 · 숫자가 아니면 빈 문자열", () => {
    expect(formatAxis("pace", 310)).toBe(`5'10"`);
    expect(formatAxis("degrees", 27.6)).toBe("28°");
    expect(formatAxis("int", 49.4)).toBe("49");
    expect(formatAxis("int", "x")).toBe("");
    expect(formatAxis("pace", NaN)).toBe("");
  });
});
