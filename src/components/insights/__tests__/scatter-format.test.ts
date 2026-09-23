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

// #425: 시간 축 — 소수 연도를 정수 연도로
describe("formatAxis year", () => {
  it("소수 연도 → 정수 연도 · 비수치는 빈 문자열", () => {
    expect(formatAxis("year", 2024)).toBe("2024");
    expect(formatAxis("year", 2024.53)).toBe("2024");
    expect(formatAxis("year", 2025.999)).toBe("2025");
    expect(formatAxis("year", "2024")).toBe("");
  });
});
